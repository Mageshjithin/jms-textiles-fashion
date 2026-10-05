import app from './api/index.js';
app.listen(Number(process.env.PORT || 3000), '127.0.0.1', () => console.log(`JMS Billing: http://localhost:${process.env.PORT || 3000}`));
