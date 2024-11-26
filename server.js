const express = require('express');
const path = require('path');
const app = express();
const port = process.env.PORT || 8000;

// Serve static files from the root directory
app.use(express.static('./'));

// Handle both root and callback routes by serving index.html
app.get(['/', '/callback'], (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});