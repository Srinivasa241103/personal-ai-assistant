import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

const app = express();

//base config
app.use(express.json({limit: '16kb'}));
app.use(express.urlencoded({extended: true}));
app.use(express.static('public'));

app.use(
    cors({
        origin : process.env.CORS_ORIGIN?.split(','),
        credentials: true,
        methods : ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
        allowedHeaders : ['Content-Type', 'Authorization']
    }));

app.get('/', (req, res) => {
    res.send('API is running...');
});

export default app;