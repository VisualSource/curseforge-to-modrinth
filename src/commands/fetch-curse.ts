// /files/all?page=1&pageSize=20&version=1.20.1&gameVersionTypeId=1

import path from "node:path";
import fs from "node:fs";
import puppeteer from "puppeteer";
import chalk from "chalk";
import { EventEmitter } from 'node:events';
import crypto from 'node:crypto';
import { CommandBuilder, CommandModule } from "yargs";
import { setCommand, setCommandArgs } from "../index.js";
import { Commands } from "./index.js";
import { LogType, log } from "../util/log.js";
import ProgressBar from "progress";

function getFileHash(filepath: string) {
    return new Promise<string>((ok, rej) => {
        const hash = crypto.createHash("sha1");
        hash.setEncoding("hex");
        let stream = fs.createReadStream(filepath);

        stream.on("end", () => {
            hash.end();
            ok(hash.read());
        })

        stream.on("error", (e) => {
            rej(e);
        })

        stream.pipe(hash);
    });
}

export default async function run(args: Args) {
    const modListPath = path.resolve(args.path)
    if (!fs.existsSync(modListPath)) {
        console.log(
            chalk.red.bold('Error: ') +
            chalk.redBright('The file does not exist: ') +
            modListPath
        )
        process.exit(1)
    }

    const emitter = new EventEmitter();
    const em = new EventEmitter();
    const fileData = fs.readFileSync(modListPath, { "encoding": "utf-8" });
    const data = JSON.parse(fileData) as { files: { _comment: string, fileSize: number, path: string, hashes: { sha1: string }, downloads: string[], }[] };

    const browser = await puppeteer.launch({ headless: false });
    const page = await browser.newPage();
    await page.setViewport({ width: 1080, height: 1024 });
    const download_dir = path.join(process.env.USERPROFILE as string, "/Downloads");

    console.log("Download Directory", download_dir);

    const client = await page.createCDPSession();
    await client.send("Browser.setDownloadBehavior", {
        behavior: "allow",
        downloadPath: download_dir,
        eventsEnabled: true
    });
    await page.setRequestInterception(true);
    client.on("Browser.downloadProgress", (e) => {
        if (e.state === "completed") {
            em.emit("download", { status: "ok", bytes: e.totalBytes });
        } else if (e.state === "canceled") {
            em.emit("download", { status: "error", bytes: 0 });
        }
    });
    page.on("request", (req) => {
        if (req.url().endsWith(".jar")) {
            emitter.emit("url", req.url());
        }
        req.continue();
    });
    const progressBar = new ProgressBar(
        '[:bar|:percent :current/:total]',
        data.files.filter(e => "_comment" in e && e.hashes.sha1.length === 0).length
    );
    let index = data.files.findIndex(e => "_comment" in e && e.hashes.sha1.length === 0);
    while (index !== -1) {
        try {
            progressBar.interrupt(chalk.green("Fetching mod from: ", data.files[index]._comment))

            const link = `${data.files[index]._comment}/files/all?page=1&pageSize=20&version=1.20.1&gameVersionTypeId=1`
            await page.goto(link);

            const file_list_selector = await page.waitForSelector("div.files-table");
            const to_download = await file_list_selector?.waitForSelector("div.file-row:nth-child(2) > a:nth-child(1)")
            await Promise.all([
                page.waitForNavigation(),
                to_download?.click()
            ]);

            const download_btn = await page.waitForSelector("a.btn-cta:nth-child(1)");

            await Promise.all([
                page.waitForNavigation(),
                download_btn?.click()
            ]);

            const [url, bytes] = await Promise.all([
                new Promise<string>((ok) => {
                    emitter.once("url", e => ok(e))
                }),
                new Promise<number>((ok, rej) => em.once("download", (ev) => {
                    if (ev.status === "ok") {
                        ok(ev.bytes);
                    } else if (ev === "error") {
                        rej("Download was cancelled");
                    }
                }))
            ])

            const filename = path.parse(url).base;
            const download_file = path.join(download_dir, filename);

            data.files[index].hashes.sha1 = await getFileHash(decodeURIComponent(download_file));
            data.files[index].path = `mods/${filename}`;
            data.files[index].downloads.push(url);
            data.files[index].fileSize = bytes;
            fs.writeFileSync(modListPath, JSON.stringify(data, undefined, 2), { encoding: "utf-8" });

            await new Promise<void>((ok, err) => {
                fs.rm(download_file, (e) => {
                    if (e) {
                        err(e);
                    }
                    ok();
                })
            });

        } catch (error) {
            progressBar.interrupt(chalk.red((error as Error).message));
        }

        progressBar.tick();

        index = data.files.findIndex(e => "_comment" in e && e.hashes.sha1.length === 0);
    }

    await browser.close();

}

export const builder: CommandBuilder<Args> = {
    path: {
        string: true,
        demandOption: 'Usage: curseforge-to-modrinth parse-curse --path <path>',
    },
}

export const module: CommandModule<{}, Args> = {
    handler: (args) => {
        setCommand(Commands.PARSE_CURSE)
        setCommandArgs(args)
    },
    command: ['thrd'],
    builder: builder,
}

export interface Args {
    path: string
}
