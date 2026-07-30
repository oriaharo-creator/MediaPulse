const express = require('express');
const cors = require('cors');
const downloadHandler = require('./api/download');

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());

// Health check endpoint
app.get('/', (req, res) => {
    res.send('MediaPulse API is running');
});

// Download endpoint using the existing handler
app.get('/api/download', downloadHandler);

app.listen(port, () => {
    console.log(`MediaPulse API listening at http://localhost:${port}`);
});
