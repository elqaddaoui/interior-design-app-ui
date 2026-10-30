require('node:http')
  .createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ping ok | PORT=' + process.env.PORT + ' | ' + req.url);
  })
  .listen(process.env.PORT || 3000, () => console.log('[ping] listening on', process.env.PORT || 3000));
