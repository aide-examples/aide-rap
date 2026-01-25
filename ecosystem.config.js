// PM2 Ecosystem Configuration for AIDE RAP
// Usage: pm2 start ecosystem.config.js

module.exports = {
  apps: [
    {
      name: 'aide-rap-irma',
      script: 'rap.js',
      cwd: './app',
      args: '-s irma',

      // Use system node (not nvm) - adjust path if needed
      // Find your node: which node
      // interpreter: '/usr/bin/node',

      // Environment
      env: {
        NODE_ENV: 'production'
      },

      // Restart policy
      autorestart: true,
      max_restarts: 10,
      restart_delay: 1000,

      // Logging
      error_file: './app/systems/irma/logs/pm2-error.log',
      out_file: './app/systems/irma/logs/pm2-out.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',

      // Watch (optional, for dev)
      watch: false
    }

    // Add more systems as needed:
    // {
    //   name: 'aide-rap-book',
    //   script: 'rap.js',
    //   cwd: './app',
    //   args: '-s book_2',
    //   ...
    // }
  ]
};
