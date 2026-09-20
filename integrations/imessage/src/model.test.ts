import {test} from 'node:test';
import assert from 'node:assert/strict';
import {imessageModel} from './model';
test('explicit OpenAI config reuses an existing account without requiring Nebius', () => {
 const model = imessageModel({IMESSAGE_MODEL_PROVIDER: 'openai', OPENAI_API_KEY: 'fixture-only', IMESSAGE_MODEL: 'gpt-4.1-mini'});
 assert.equal(model.providerId, 'openai'); assert.equal(model.url, 'https://api.openai.com/v1');
 assert.throws(() => imessageModel({IMESSAGE_MODEL_PROVIDER: 'openai', IMESSAGE_MODEL: 'gpt-4.1-mini'}), /OPENAI_API_KEY/);
 assert.throws(() => imessageModel({IMESSAGE_MODEL_PROVIDER: 'unexpected'}), /must be/);
});
test('existing Nebius config remains compatible and providers never silently switch', () => {
 assert.equal(imessageModel({NEBIUS_API_KEY: 'fixture-only', NEBIUS_MODEL: 'configured-model'}).providerId, 'nebius');
 assert.throws(() => imessageModel({OPENAI_API_KEY: 'fixture-only'}), /NEBIUS_API_KEY/);
});
