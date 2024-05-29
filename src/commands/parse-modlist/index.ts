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

				const chunk_count = Math.ceil(mods.length / 300)
				let chunks = [];
				
				for(let i = 0; i < chunk_count; i++){
					chunks.push(mods.slice(300*i,300 * (i+1)));
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
							})
							.then((data) => {
								modrinthSearchProgressBar.tick()
								return data
							})
					});
					queries.push(a);
					if(chunk_count > 1) {
						log(LogType.INFO, ['Ratelimit: wating 1min'])
						await new Promise<void>((ok)=>setTimeout(()=>ok(),60_000))
					}
				
				}

				const modrinthQueries = queries.flat();

				Promise.all(modrinthQueries).then((queries) => {
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
					})
				});
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
