import { exit } from 'process'
import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'
import { Commands } from './commands/index.js'
import {
	Args as parseModlistArgs,
	default as runParseModlist,
	module as parseModlistModule,
} from './commands/parse-modlist/index.js'
import { default as runCurseModule, module as parseCurseModule, Args as parseCurseArgs } from './commands/fetch-curse.js';
import { log, LogType } from './util/log.js'

let command: Commands = Commands.NONE
let commandArgs: parseModlistArgs = { path: '' }

export function setCommand(_command: Commands) {
	command = _command
}

export function setCommandArgs(_commandArgs: parseModlistArgs) {
	commandArgs = _commandArgs
}

export interface Argv {
	[x: string]: unknown
	path: string
	verbose: boolean | undefined
	_: (string | number)[]
	$0: string
}

export const argv = yargs(hideBin(process.argv))
	.scriptName('curseforge-to-modrinth')
	.usage('$0 <cmd> [args]')
	.help()
	.alias('h', 'help')
	.command<parseCurseArgs>("run", "parse CurseForge mod", parseCurseModule)
	.command<parseModlistArgs>(
		'parse',
		'Parse a CurseForge modlist and returns both Modrinth URLS and mods not on Modrinth',
		parseModlistModule
	)
	.option('verbose', {
		alias: 'v',
		type: 'boolean',
		description: 'Runs with verbose logging',
	})
	.demandCommand()
	.parseSync()

if (command.valueOf() == Commands.PARSE_MODLIST.valueOf()) {
	runParseModlist(commandArgs as parseModlistArgs)
} else if (command.valueOf() === Commands.PARSE_CURSE.valueOf()) {
	runCurseModule(commandArgs as parseCurseArgs);
} else {
	log(LogType.ERROR, ['No command provided (or command is invalid).'])
	exit(0)
}
