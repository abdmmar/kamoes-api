import type { DenonConfig } from 'https://deno.land/x/denon@2.5.0/mod.ts';

const config: DenonConfig = {
	scripts: {
		dev: {
			cmd: 'deno run index.ts',
			desc: 'Run kamoes-api on development mode',
			allow: ['net', 'read', 'write'],
			importMap: 'import_map.json',
		},
	},
};

export default config;
