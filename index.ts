import { oakCors } from 'cors';
import { blue, cyan, green, red } from 'fmt/colors';
import { Application, isHttpError, Router, Status } from 'oak';
import { RateLimiter } from 'oak-rate-limit';
import { Snelm } from 'snelm';
import * as path from 'path'

import { dictionaryPath, getWordDefinition, initDictionary } from './src/dictionary.ts';

const port = 8000;
const currentDictionary = await initDictionary();

const app = new Application();
const snelm = new Snelm('oak', {
	hidePoweredBy: null,
});
const rateLimit = RateLimiter({
	windowMs: 1000,
	max: 5,
	headers: true,
	message: 'Too many requests, please try again later.',
	statusCode: 429,
});

app.use(oakCors());

app.use(await rateLimit);

app.use(async (ctx, next) => {
	ctx.response = snelm.snelm(ctx.request, ctx.response);

	await next();
});

app.use(async (ctx, next) => {
	await next();
	const rt = ctx.response.headers.get('X-Response-Time');
	console.log(
		`${green(ctx.request.method)} ${ctx.request.url} - ${blue(rt || '-1')}`,
	);
});

app.use(async (ctx, next) => {
	const start = Date.now();
	await next();
	const ms = Date.now() - start;
	ctx.response.headers.set('X-Response-Time', `${ms}ms`);
});

app.use(async (ctx, next) => {
	try {
		await next();
	} catch (err) {
		console.log(err);
		if (isHttpError(err)) {
			switch (err.status) {
				case Status.NotFound:
					console.log(
						`${red('ERROR')}:${err.status} ${ctx.request.url} - ${err.message}`,
					);
					ctx.response.status = err.status;
					ctx.response.body = {
						message: 'Not Found',
					};
					break;
				default:
					console.log(
						`${red('ERROR')}:${err.status} ${ctx.request.url} - ${err.message}`,
					);
					ctx.response.status = err.status;
					ctx.response.body = {
						message: 'Internal Server Error',
					};
					break;
			}
		} else {
			throw err;
		}
	}
});

const router = new Router();

router.get('/:word', async (ctx) => {
	const { word } = ctx.params;
	const wordFilePath = currentDictionary.get(word);

	try {
		if (wordFilePath) {
			const decoder = new TextDecoder('utf-8');
			const definitionBytes = await Deno.readFile(wordFilePath);
			const definitionString = decoder.decode(definitionBytes);
			const definition = JSON.parse(definitionString);
			return ctx.response.body = definition;
		}

		const definition = await getWordDefinition(word);
		currentDictionary.set(word, path.join(dictionaryPath, `${word}.json`));

		if (!definition) ctx.throw(404);

		ctx.response.body = definition;
	} catch (error) {
		throw error;
	}
});

app.use(router.routes());
app.use(router.allowedMethods());
app.use((ctx) => {
	ctx.throw(404);
});

console.log(`Listening at ${cyan(`http://localhost:${port}`)}`);
await app.listen({ port });
