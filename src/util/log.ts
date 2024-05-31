import chalk from 'chalk'
import { argv } from '../index.js';

export enum LogType {
	INFO,
	RESULT,
	ERROR,
}

export function log(logType: LogType, message: string[], verboseOnly?: true) {
	if (verboseOnly && !argv.verbose) return
	switch (logType) {
		case LogType.INFO:
			console.log(chalk.cyanBright.bold('Info: '), ...message)
			break
		case LogType.RESULT:
			console.log(chalk.greenBright.bold('Result: '), ...message)
			break
		case LogType.ERROR:
			console.error(chalk.redBright.bold('Info: '), ...message)
			break
		default:
	}
}
