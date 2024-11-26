const express = require('express');
const path = require('path');
const app = express();
const port = 8000;

// Serve static files from the root directory
app.use(express.static('./'));

// Handle both root and callback routes by serving index.html
app.get(['/', '/callback'], (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});