module.exports = {
  apps: [
    // 后端服务
    {
      name: 'backend',
      cwd: '/home/ubuntu/stock-flow/backend',
      script: 'uvicorn',
      args: 'app.main:app --reload --port 8000',
      interpreter: 'python3',
      watch: false,
      env: {
        NODE_ENV: 'development'
      },
      error_file: '/home/ubuntu/stock-flow/logs/backend-error.log',
      out_file: '/home/ubuntu/stock-flow/logs/backend-out.log',
      log_file: '/home/ubuntu/stock-flow/logs/backend-combined.log',
      time: true
    },
    // 前端服务
    {
      name: 'frontend',
      cwd: '/home/ubuntu/stock-flow/frontend',
      script: 'npm',
      args: 'run dev',
      watch: false,
      env: {
        NODE_ENV: 'development'
      },
      error_file: '/home/ubuntu/stock-flow/logs/frontend-error.log',
      out_file: '/home/ubuntu/stock-flow/logs/frontend-out.log',
      log_file: '/home/ubuntu/stock-flow/logs/frontend-combined.log',
      time: true
    },
    // ngrok 服务（同时暴露前端和后端）
    {
      name: 'ngrok',
      script: 'ngrok',
      args: 'http 5173 --host-header=rewrite --log=stdout --log-level=info',
      interpreter: 'none',
      watch: false,
      env: {
        NGROK_AUTHTOKEN: '3F1ZN8ZuCNZQbpvIPmkRg8cKH9y_4ZLS3bgZSEYmaM4YyHL3T'  // 可选，也可以已配置
      },
      error_file: '/home/ubuntu/stock-flow/logs/ngrok-error.log',
      out_file: '/home/ubuntu/stock-flow/logs/ngrok-out.log',
      log_file: '/home/ubuntu/stock-flow/logs/ngrok-combined.log',
      time: true,
      // ngrok 需要特殊处理，使用 exec_mode 为 fork
      exec_mode: 'fork'
    }
  ]
};
