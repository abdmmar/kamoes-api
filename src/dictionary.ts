import * as path from 'path';
import { cheerio } from 'cheerio';

type Info = {
	sumber: string;
	sumberTeks: string;
};

type BaseMakna = {
	tipe?: string;
	tipeTeks?: string;
};

type Makna = BaseMakna & {
	definisi: string;
	contoh: string | null;
	info: Array<Info>;
};

type ReferensiMakna = BaseMakna & {
	referensi: string[];
};

type Definition = {
	sukuKata: string | null;
	akarKata: string | null;
	ejaan: string | null;
	baku: boolean;
	alt: string | null;
	makna: Array<Makna | ReferensiMakna>;
};

export const dictionaryPath = path.join(Deno.cwd(), '/src/data/dictionary/');

function cleanup(text: string) {
	return text.trim().replace(/\d/g, '').replace(/\//g, '');
}

export async function getDefinitions(word: string) {
	const res = await fetch(`https://kbbi.kemdikbud.go.id/entri/${word}`, {
		headers: {
			'User-Agent':
				'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/96.0.4664.110 Safari/537.36',
			'Accept':
				'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
			'Accept-Encoding': 'gzip, deflate, br',
			'accept-language': 'en-GB,en;q=0.9',
		},
	});
	const html = await res.text();
	const $ = cheerio.load(html);

	if (res.status !== 200) {
		throw new Error('Rate limited');
	}

	const definition: Array<Definition> = await Promise.all(
		$('h2[style="margin-bottom:3px"]').toArray().map(async (el) => {
			const ejaan = cleanup($(el).find('span.syllable').text());
			$(el).find('span.syllable').remove();
			const tidakBaku = cleanup($(el).find('small b').text());
			$(el).find('small').remove();

			let sukuKata = cleanup($(el).text());
			let akarKata = null;
			if (sukuKata.includes('»')) {
				[akarKata, sukuKata] = sukuKata.split('»').map((s) => s.trim());
			}

			const $list = $(el).nextAll('ul.adjusted-par, ol').first();
			const $firstResult = $list.find('li').first();

			if ($firstResult.text().includes('→')) {
				const $bentukBaku = $firstResult.find('a');
				const alt = cleanup($bentukBaku.text());
				const [bentukBakuSearch] = $bentukBaku?.attr('href')?.split('/').reverse() || [];
				const definisi = await getDefinitions(bentukBakuSearch);

				return {
					sukuKata,
					akarKata,
					ejaan: ejaan === '' ? sukuKata.replace(/\./g, '') : ejaan,
					baku: false,
					alt,
					makna: definisi[0].makna,
				};
			}

			const makna = [];

			$list.find('li').each((_, el) => {
				const $info = $(el).find('font[color="red"]').first();

				let tipe;
				let tipeTeks;
				const info: Array<{ sumber: string; sumberTeks: string | null }> = [];

				if ($info.length === 1) {
					$info.find('span').each((i, el) => {
						switch (i) {
							case 0: {
								const [type, typeText] = $(el)?.attr('title')?.split(':').map((s) =>
									s.trim().toLowerCase()
								) || [];
								tipe = type;
								tipeTeks = typeText;
								break;
							}
							default: {
								const [source, sourceText] = $(el)?.attr('title')?.split(':').map((s) =>
									s.trim().toLowerCase()
								) || [];
								info.push({
									sumber: source,
									sumberTeks: sourceText === '-' ? null : sourceText,
								});
								break;
							}
						}
					});
				}

				const contoh = $(el).find('font[color="grey"]:nth-child(3)').text()
					.trim();
				$(el).find('font').remove();
				const definisi = $(el).text().trim().replace(/:$/, '');

				makna.push({
					tipe,
					tipeTeks,
					definisi,
					contoh: contoh === '' ? null : contoh,
					info,
				});
			});

			const $prakategorial = $(el).nextAll('font[color="darkgreen"]').first();
			if (
				$list.length === 0 &&
				$prakategorial.length === 1
			) {
				const [type, typeText] = $prakategorial?.attr('title')?.split(':').map((s) =>
					s.trim().toLowerCase()
				) || [];

				makna.push({
					tipe: type,
					tipeTeks: typeText,
					referensi: $prakategorial.nextAll('font[color="grey"]').first().text()
						.trim().split(',').map((s) => s.trim()),
				});
			}

			return {
				sukuKata,
				akarKata,
				ejaan: ejaan === '' ? sukuKata.replace(/\./g, '') : ejaan,
				baku: true,
				alt: tidakBaku || null,
				makna,
			};
		}),
	);

	return definition;
}

export async function storeWordDefinition(
	wordAsFile: string,
	definitions: Definition[],
) {
	const storedFilePath = wordAsFile.replace(/ /g, '_').toLowerCase() + '.json';
	const dictionaryPath = path.join(Deno.cwd(), 'src/data/dictionary');

	await Deno.writeTextFile(
		path.join(dictionaryPath, storedFilePath),
		JSON.stringify(definitions, null, 2),
	);
}

async function initWordList() {
	const decoder = new TextDecoder();
	const entriesBytes = await Deno.readFile(
		path.join(Deno.cwd(), '/src/data/words.json'),
	);
	const entriesString = decoder.decode(entriesBytes);
	const entries: string[] = JSON.parse(entriesString);
	return new Set(entries);
}

const wordList = await initWordList();

function isValidWord(word: string) {
	return wordList.has(word);
}

export async function getWordDefinition(word: string) {
	try {
		if (!isValidWord(word)) return null;

		const definition = await getDefinitions(word);

		if (definition.length === 0) return null;

		await storeWordDefinition(word, definition);
		return definition;
	} catch (error) {
		throw error;
	}
}

export function initDictionary() {
	const currentFiles = Deno.readDirSync(dictionaryPath);
	const files: Map<string, string> = new Map();

	for (const file of currentFiles) {
		files.set(
			file.name.replaceAll('_', ' ').replace('.json', ''),
			path.join(dictionaryPath, file.name),
		);
	}

	return files;
}
