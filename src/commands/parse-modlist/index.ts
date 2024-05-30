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
			if (answer.verifyContinue) {
				const modrinthSearchProgressBar = new ProgressBar(
					'[:bar|:percent :current/:total]',
					mods.length
				);

				const CHUNK_SIZE = 300;

				const chunk_count = Math.ceil(mods.length / CHUNK_SIZE)
				let chunks = [];
				for (let i = 0; i < chunk_count; i++) {
					chunks.push(mods.slice(CHUNK_SIZE * i, CHUNK_SIZE * (i + 1)));
				}

				log(LogType.INFO, [
					"Chunk Count",
					chunk_count.toString()
				]);

				let queris = [];
				for (let chunk = 0; chunk < chunks.length; chunk++) {
					const results = chunks[chunk].map(async (item) => {
						const searchResult = await searchProjects({
							query: item.name,
						});

						modrinthSearchProgressBar.tick();
						return {
							search: searchResult,
							metadata: item
						}
					});
					queris.push(results);
					if (chunk_count > 1 && chunk != (chunk_count - 1)) {
						await new Promise<void>((ok) => setTimeout(() => ok(), 60_000))
					}
				}

				const data = await Promise.all(queris.flat());
				log(LogType.INFO, [
					"Length",
					data.length.toString()
				]);


				for (const item of data) {

					const sugest = item.search.hits.findIndex(e => e.author === item.metadata.author && e.title === item.metadata.name)


					const r = await prompts({
						type: "select",
						hint: "A",
						name: "project",
						message: `Select Project: ${item.metadata.name}: (${item.metadata.author}) - ${item.metadata.curseUrl} `,
						initial: sugest === -1 ? 1 : sugest + 2,
						choices: [{ title: "None", value: "NULL" }, { title: "Next", value: "NEXT" }].concat(item.search.hits.map(e => ({ title: `${e.title} (${e.author}) (${e.project_type}) (https://modrinth.com/${e.project_type}/${e.slug})`, value: e.project_id })))
					});


					if (r.project as string === "NULL") {
						break;
					}
				}





				/*

				

				
				let queries = [];
				for (const chunk of chunks) {
					const a = chunk.map((mod) => {
						return axios
							.get<
								operations['searchProjects']['responses']['200']['content']['application/json']
							>('https://api.modrinth.com/v2/search', {
								params: {
									query: mod.name,
								},
								headers: {
									'x-query-name': Buffer.from(mod.name).toString('base64'),
									'x-query-author': mod.author,
									'x-query-curseforge-url': mod.curseUrl || '',
								},
							}).then((data) => {
								modrinthSearchProgressBar.tick()
								return data
							}).then(async (query) => {
								if (query.data.total_hits <= 0) {
									console.log({
										name: Buffer.from(
											query.request.getHeader('x-query-name'),
											'base64'
										).toString('utf8'),
										author: query.request.getHeader('x-query-author'),
										curseUrl: query.request.getHeader('x-query-curseforge-url'),
									})
									return null;
								}

								const data = await axios.get<operations["getProjectVersions"]["responses"]["200"]["content"]["application/json"]>(`https://api.modrinth.com/v2/project/${query.data.hits[0].project_id}/version${query.data.hits[0].project_type === "mod" ? `?loaders=["forge"]&game_versions=["1.20.1","1.20"]` : ""}`);

								if (!data.data[0]?.files) {
									console.info("Getting", query.data.hits[0].title, query.data.hits[0].project_id);
									return null;
								}

								return {
									type: query.data.hits[0].project_type,
									target: data.data[0].files.find(e => e.primary) ?? data.data[0].files.at(0)
								}
							});
					});
					queries.push(a);
					if (chunk_count > 1) {
						log(LogType.INFO, ['Ratelimit: wating 1min'])
						await new Promise<void>((ok) => setTimeout(() => ok(), 60_000))
					}

				}

				const modrinthQueries = await Promise.all(queries.flat());
				const files = modrinthQueries.filter(Boolean).map((resource) => {

					return {
						path: `${resource?.type === "mod" ? "mods" : "resourcepacks"}/${resource?.target?.filename}`,
						hashes: resource?.target?.hashes,
						env: {
							"client": "required",
							"server": "unsupported"
						},
						downloads: [
							resource?.target?.url
						],
						fileSize: resource?.target?.size
					}
				});


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
				})*/

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
			} else {
				process.exit(0)
			}
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
