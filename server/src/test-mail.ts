import { loadConfig } from './config.js';
import { createMailer } from './services/mailer.js';

const config = loadConfig();
const mailer = createMailer(config);

await mailer.send({
  to: 'student@example.edu',
  subject: 'U-Safe test mail',
  text: 'This is a test message. Code: 123456',
  code: '123456',
});

console.log('Test mail sent.');
