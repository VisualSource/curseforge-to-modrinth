import axios from 'axios'
import chalk from 'chalk'
import fs from 'fs'
import { parse } from 'node-html-parser'
import path from 'path'
import ProgressBar from 'progress'
import prompts from 'prompts'
import { CommandBuilder, CommandModule } from 'yargs'
import { Commands } from '..'
import { setCommand, setCommandArgs } from '../..'
import { operations } from '../../api/modrinth'
import { log, LogType } from '../../util/log'

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
				)

				const chunk_count = Math.ceil(mods.length / 150)
				let chunks = [];
				
				for(let i = 0; i < chunk_count; i++){
					chunks.push(mods.slice(150*i,150 * (i+1)));
				}

				let queries = [];
				for(const chunk of chunks){
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
							}).then(async (query)=>{
								if(query.data.total_hits <= 0) {
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
						
								const data = await axios.get<operations["getProjectVersions"]["responses"]["200"]["content"]["application/json"]>(`https://api.modrinth.com/v2/project/${query.data.hits[0].project_id}/version${query.data.hits[0].project_type === "mod" ? `?loaders=["forge"]&game_versions=["1.20.1","1.20"]`:""}`);

								if(!data.data[0]?.files) {
									console.info("Getting", query.data.hits[0].title,query.data.hits[0].project_id);
									return null;
								}

								return {
									type: query.data.hits[0].project_type,
									target: data.data[0].files.find(e=>e.primary) ?? data.data[0].files.at(0)
								}
							});
					});
					queries.push(a);
					if(chunk_count > 1) {
						log(LogType.INFO, ['Ratelimit: wating 1min'])
						await new Promise<void>((ok)=>setTimeout(()=>ok(),60_000))
					}
				
				}

				const modrinthQueries = await Promise.all(queries.flat());
				const files = modrinthQueries.filter(Boolean).map((resource)=>{

					return {
						path: `${resource?.type === "mod" ? "mods": "resourcepacks"}/${resource?.target?.filename}`,
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

				fs.writeFile("./modrinth.index.json",JSON.stringify(mrpack),{ encoding: "utf-8" },(err)=>{
					if(err){
						console.error(err);
					}
				})

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
