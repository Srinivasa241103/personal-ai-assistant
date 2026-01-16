import dotenv from 'dotenv';
dotenv.config();

import app from './src/app.js';
import {connectToDB} from './src/config/dbConfig.js';

const PORT = process.env.PORT || 9000;


connectToDB().then(()=>{
    console.log('Starting server...');
    app.listen(PORT, () => {
        console.log(`Server is running http://localhost:${PORT}`);
    });
})
.catch((err)=>{
    console.error('Failed to connect to the database', err);
    process.exit(1);
});
