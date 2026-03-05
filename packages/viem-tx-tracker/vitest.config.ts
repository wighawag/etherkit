import {defineConfig} from 'vitest/config';
import {join} from 'node:path';

export default defineConfig({
	test: {
		include: ['test/**/*.test.ts'],
		globalSetup: [join(__dirname, './test/prool/globalSetup.ts')],
		testTimeout: 20000,
		coverage: {
			provider: 'v8',
			include: ['src/**/*.ts'],
			reporter: ['text', 'html'],
			thresholds: {
				statements: 80,
				branches: 80,
				functions: 80,
				lines: 80,
			},
		},
	},
});
