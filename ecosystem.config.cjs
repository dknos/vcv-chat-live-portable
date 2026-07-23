const path = require('node:path');

module.exports = {
  apps: [
    {
      name: 'vcv-chat-live',
      cwd: __dirname,
      script: path.join(__dirname, 'src', 'main.js'),
      interpreter: 'node',
      autorestart: true,
      max_restarts: 10,
      restart_delay: 2000,
      env: {
        CHAT_SOURCE: 'session',
        CHAT_SESSION_FILE: path.join(__dirname, 'state', 'live-session.json'),
        OSC_HOST: '127.0.0.1',
        OSC_PORT: '7001',
        OVERLAY_HOST: '127.0.0.1',
        OVERLAY_PORT: '9392',
      },
    },
  ],
};
