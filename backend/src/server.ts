import { createApp } from './app';
import { env } from './config/env';

createApp().listen(env.PORT, () => console.log(`Slotify API listening on :${env.PORT} (${env.NODE_ENV})`));
