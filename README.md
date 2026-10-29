# LifeLink - Emergency Blood Requirement & Donor Coordination System
Full stack: HTML/CSS/JS front end, Node.js + Express API, SQLite (SQL) database (Node's built-in node:sqlite, needs Node 22.5+).

## Run
    npm install
    npm start
Public site: http://localhost:3000
Admin site:  http://localhost:3000/admin   (default password: admin123)

Change the password / port:
    ADMIN_PASSWORD=mysecret PORT=4000 npm start          (Linux/Mac)
    set ADMIN_PASSWORD=mysecret&& npm start               (Windows cmd)

The database file `blood.db` is created automatically on first run.

## Tables
donors, requests, responses, notifications
