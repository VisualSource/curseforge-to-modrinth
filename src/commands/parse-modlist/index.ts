import { CommandBuilder, CommandModule } from 'yargs'
import { parse } from 'node-html-parser'
import ProgressBar from 'progress'
import prompts from 'prompts'
import chalk from 'chalk'
import path from 'path'
import fs from 'fs'

import { getProjectVersions, getProject, searchProjects } from "../../api/modrinth/services.gen.js"
import { setCommand, setCommandArgs } from "../../index.js";
import { log, LogType } from '../../util/log.js';
import { Commands } from '../index.js';
import { ProjectResult, Version, VersionFile } from '../../api/modrinth/types.gen.js'

const chunk_requests = async <T, R>(list: T[], action: (item: T) => Promise<R>, chunk_size: number) => {
	const progressBar = new ProgressBar(
		'[:bar|:percent :current/:total]',
		list.length
	);
	const chunk_count = Math.ceil(list.length / chunk_size);
	let chunks = [];
	for (let i = 0; i < chunk_count; i++) {
		chunks.push(list.slice(chunk_size * i, chunk_size * (i + 1)));
	}

	log(LogType.INFO, [
		"Chunk Count",
		chunk_count.toString()
	]);

	let queris = [];
	for (let chunk = 0; chunk < chunks.length; chunk++) {
		let output = [];
		for (const item of chunks[chunk]) {
			const result = await action(item);
			progressBar.tick();
			output.push(result);
		}
		queris.push(output);
		if (chunk_count > 1 && chunk != (chunk_count - 1)) {
			await new Promise<void>((ok) => setTimeout(() => ok(), 60_000))
		}
	}

	const data = await Promise.all(queris.flat());
	log(LogType.INFO, [
		"Length",
		data.length.toString()
	]);
	return data;
}

type MrpackFile = {
	_comment?: string,
	path: string,
	hashes: {
		sha1: string,
		sha512: string
	},
	env: {
		"client": "required",
		"server": "unsupported"
	},
	downloads: string[],
	fileSize: number
}

export default function run(args: Args) {
	log(LogType.INFO, ['Reading modlist file...'])

	const modListPath = path.resolve(args.path)
	if (fs.existsSync(modListPath)) {
		const modAuthorRemove = /\(by .*\)/g
		const modNameRemove1 = /.*\(by /g
		const fileData = fs.readFileSync(modListPath).toString()

		const docRoot = parse(fileData)
		const listItems = docRoot.querySelectorAll('li>a')

		const parseBar = new ProgressBar('[:bar|:percent :current/:total]', {
			total: listItems.length,
		})

		const mods = listItems.map((element) => {
			const text = element.innerHTML

			const modName = text.replace(modAuthorRemove, '').trim()
			const modAuthor = text.replace(modNameRemove1, '').replace(')', '').trim()

			parseBar.tick()

			return {
				curseUrl: element.getAttribute('href'),
				name: modName,
				author: modAuthor,
			}
		})

		log(LogType.INFO, [chalk.greenBright(mods.length), 'mods to be processed'])
		log(LogType.INFO, [
			chalk.bold(
				'This will contact the Modrinth API, which limits queries to 300 a minute, per IP address.'
			),
		])
		log(LogType.INFO, [
			chalk.bold('For more information, visit ') +
			chalk.underline.blueBright(
				'https://docs.modrinth.com/api-spec/#section/Ratelimits.'
			),
		])

		prompts({
			name: 'verifyContinue',
			message: ' Do you want to proceed?',
			type: 'confirm',
			initial: false,
		}).then(async (answer) => {
			if (!answer.verifyContinue) {
				process.exit(0);
			}
			const data = await chunk_requests(mods, async (item) => {
				const searchResult = await searchProjects({
					query: item.name,
				});

				return {
					search: searchResult,
					curse_metadata: item
				}
			}, 300);

			const found_projects = [];
			const not_found = [];
			let i = 0;
			for (const item of data) {
				const suggest_project = item.search.hits.findIndex(e => e.author.toLowerCase() === item.curse_metadata.author.toLowerCase() &&
					e.title === item.curse_metadata.name);

				const selected = await prompts({
					type: "select",
					hint: "Select matching project",
					name: "project",
					message: `(${i + 1} of ${data.length}) Select Project: ${item.curse_metadata.name}: (${item.curse_metadata.author}) - ${item.curse_metadata.curseUrl} `,
					initial: suggest_project === -1 ? 0 : suggest_project + 1,
					choices: [{ title: "Next", value: "NULL" }].concat(item.search.hits.map(e => ({ title: `${e.title} (${e.author} | ${e.project_type}) - https://modrinth.com/${e.project_type}/${e.slug}`, value: e.project_id })))
				});

				i++;
				if (selected.project === "NULL") {
					not_found.push(item.curse_metadata);
					continue;
				}
				const project = item.search.hits.find(e => e.project_id === selected.project);

				found_projects.push(project!);
			}

			const version_data = await chunk_requests(found_projects, async (item) => {

				let gameVersions = item.project_type === "mod" ? JSON.stringify(JSON.stringify(["1.20.1", "1.20"])) : undefined;
				let loaders = item.project_type === "mod" ? JSON.stringify(["forge"]) : undefined

				const project_versions = await getProjectVersions({ idSlug: item.project_id, gameVersions, loaders });

				const version = project_versions.at(0);
				const file = version?.files.find(e => e.primary) ?? version?.files.at(0);

				if (!file) {
					const items = await getProjectVersions({ idSlug: item.project_id });

					const choices = items.map(e => ({
						title: `Game: ${e.game_versions?.toReversed().slice(0, 10).join(", ")} | Loaders: ${e.game_versions?.join(", ")}`,
						value: e
					}));

					const versions = await prompts({
						name: "version",
						message: `No valid Version found: Select Version for ${item.title}`,
						type: "select",
						choices: ([{ title: "None", value: null }] as { title: string, value: null | Version }[]).concat(choices)
					});

					if (versions.version === null) {
						not_found.push(item);
						return null;
					}

					const file_choices = (versions.version as Version).files.map(e => ({
						title: `${e.filename} | Primary: ${e.primary ? "Yes" : "NO"}`,
						value: e
					}));

					const files = await prompts({
						name: "file",
						message: "Select file",
						type: "select",
						choices: ([{ title: "None", value: null }] as { title: string, value: VersionFile | null }[]).concat(file_choices)
					});

					if (files.file === null) {
						not_found.push(item);
						return null;
					}

					return { file: files.file as VersionFile, type: item.project_type }
				}

				return { file, type: item.project_type }
			}, 300);


			const files = version_data.filter(Boolean).map((resource) => {

				let root = "mods";
				if (resource?.type === "resourcepack") {
					root = "resourcepacks";
				} else if (resource?.type === "shader") {
					root = "shaderpacks";
				}

				return {
					path: `${root}/${resource?.file?.filename}`,
					hashes: resource?.file?.hashes,
					env: {
						"client": "required",
						"server": "unsupported"
					},
					downloads: [
						resource?.file?.url
					],
					fileSize: resource?.file?.size
				} as MrpackFile
			});

			for (const n of not_found) {
				files.push({
					_comment: "curseUrl" in n ? n.curseUrl : `https://modrinth.com/${(n as ProjectResult).project_type}/${(n as ProjectResult).slug}`,
					path: "",
					hashes: {
						sha1: "",
						sha512: ""
					},
					env: {
						"client": "required",
						"server": "unsupported"
					},
					downloads: [],
					fileSize: 0
				})
			}
			const mrpack = {
				dependencies: {
					minecraft: "1.20.1",
					forge: "47.2.20"
				},
				files,
				name: "All the Mods 9",
				versionId: "0.2.60",
				game: "minecraft",
				formatVersion: 1
			}

			fs.writeFile("./modrinth.index.json", JSON.stringify(mrpack), { encoding: "utf-8" }, (err) => {
				if (err) {
					console.error(err);
				}
			});


			log(LogType.RESULT, [chalk.green('Available:')])
			log(LogType.RESULT, ['✅', "Found projects", version_data.filter(Boolean).length.toString()]);

			log(LogType.RESULT, [chalk.red('Unavailable')]);
			log(LogType.RESULT, [
				'❌',
				"Not Found", not_found.length.toString()
			]);

			/*await Promise.all(modrinthQueries).then((queries) => {
				const availableOnModrinth: string[] = []
				const unavailableOnModrinth: {
					name: string
					author: string
					curseUrl: string
				}[] = []

				queries.forEach((query) => {
					if (query.data.total_hits > 0) {
						availableOnModrinth.push(`${query.data.hits[0].title} (${query.data.hits[0].slug})` || '')
					} else {
						unavailableOnModrinth.push({
							name: Buffer.from(
								query.request.getHeader('x-query-name'),
								'base64'
							).toString('utf8'),
							author: query.request.getHeader('x-query-author'),
							curseUrl: query.request.getHeader('x-query-curseforge-url'),
						})
					}
				})

				log(LogType.RESULT, [
					chalk.yellowBright('Remaining Search Requests = '),
					queries[queries.length - 1].headers['x-ratelimit-remaining'],
				])

				log(LogType.RESULT, [chalk.green('Available:')])

				availableOnModrinth.forEach((mod) => {
					log(LogType.RESULT, ['✅', mod])
				})

				log(LogType.RESULT, [chalk.red('Unavailable')])

				unavailableOnModrinth.forEach((mod) => {
					log(LogType.RESULT, [
						'❌',
						`${mod.name} by ${mod.author} (${mod.curseUrl})`,
					])
				});
			});*/

		})
	} else {
		console.log(
			chalk.red.bold('Error: ') +
			chalk.redBright('The file does not exist: ') +
			modListPath
		)
		process.exit(1)
	}
}

export const builder: CommandBuilder<Args> = {
	path: {
		string: true,
		demandOption: 'Usage: curseforge-to-modrinth parse-modlist --path <path>',
	},
}

export const module: CommandModule<{}, Args> = {
	handler: (args) => {
		setCommand(Commands.PARSE_MODLIST)
		setCommandArgs(args)
	},
	command: ['parse-modlist', 'parse'],
	builder: builder,
}

export interface Args {
	path: string
}
