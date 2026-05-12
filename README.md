# KeyDog 🐾

A web-based key and door management system for campuses with distributed buildings. KeyDog lets you map every door on your campus, manage your entire key system and hierarchy, assign keys to doors, and import bulk data — all from a simple web interface.

---

## Features

- **Interactive Campus Map** — Place doors on a map, click markers to view door details in a popup, with a link to the full door detail page
- **Door Management** — Add, edit, and organize doors by building, floor, and room
- **Key Management** — Create keys, define their type (grand master, master, sub-master, change key), and relate them to each other in a hierarchy
- **Key Hierarchy View** — Select any key and visualize its full hierarchy tree — what it opens above and below it in the system
- **Combinations** — Assign keys to doors and manage which keys open which doors
- **System Accounts** — Track account-level access and system users
- **Bulk Import** — Import doors, keys, users, combinations, and system accounts via CSV

---

## Tech Stack

- **Backend** — Node.js, Express, SQLite
- **Frontend** — HTML, CSS, JavaScript
- **Process Manager** — PM2
- **Reverse Proxy** — Nginx

---

## Getting Started

### Prerequisites

- Node.js v18+ (install via [nvm](https://github.com/nvm-sh/nvm))
- npm
- Git

### Installation

```bash
# Clone the repo
git clone https://github.com/ConnorFiatal/k-t.git
cd k-t

# Install dependencies
npm install

# Start the development server
node server.js
```

The app will be available at `http://localhost:3000`.

---

## Usage

### Doors
Navigate to `/doors` to view all doors. Click **Add Door** to create a new entry with building, floor, room, and type information. Each door has a detail page where you can edit its properties and manage key assignments.

### Map
Navigate to `/map` to view all doors plotted on the campus map. Click any marker to see a summary popup with a link to that door's detail page. New doors can be placed by clicking on the map.

### Keys
Navigate to `/keys` to view and manage all keys. Each key can be assigned a type and linked to a parent key to build out the hierarchy.

### Key Hierarchy
From any key's detail page, click **View Hierarchy** to see an interactive tree diagram showing the full key system — ancestors above, descendants below, and which doors each key opens.

### Combinations
Combinations link keys to doors. Manage them from the door or key detail pages, or import them in bulk via CSV.

---

## Bulk Import

Navigate to `/import.html` to access the import tool. Each entity has its own upload form and a downloadable CSV template.

### Import Order
Always import in this order to avoid reference errors:
1. **Users**
2. **Doors**
3. **Keys**
4. **Combinations** (requires doors and keys to exist first)
5. **System Accounts**

### CSV Templates

**doors.csv**
```
name,building,floor,room,description,door_type
Main Entrance,Admin Building,1,101,Front door,exterior
```

**keys.csv**
```
code,name,description,key_type,parent_key_code
GM-01,Grand Master,,grandmaster,
M-01,Master Key A,,master,GM-01
```

**users.csv**
```
name,email,role
Jane Smith,jane@campus.edu,admin
```

**combinations.csv**
```
key_code,door_name
M-01,Main Entrance
```

**system_accounts.csv**
```
account_name,username,access_level,notes
Facilities,facilities_admin,full,Main facilities account
```

Duplicate rows are skipped automatically. After each import you'll see a summary of rows inserted, skipped, and failed.

---

## Deployment

KeyDog is designed to run on a Linux server (Ubuntu recommended). The following uses a DigitalOcean Droplet with PM2 and Nginx.

### Server Setup

```bash
# Install nvm and Node
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.3/install.sh | bash
source ~/.bashrc
nvm install --lts

# Install PM2
npm install -g pm2

# Clone and install
git clone https://github.com/ConnorFiatal/k-t.git
cd k-t
npm install

# Start with PM2
pm2 start server.js --name keydog
pm2 startup
pm2 save
```

### Nginx Configuration

```bash
apt install nginx
nano /etc/nginx/sites-available/default
```

Replace the `location /` block with:

```nginx
location / {
    proxy_pass http://localhost:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection 'upgrade';
    proxy_set_header Host $host;
    proxy_cache_bypass $http_upgrade;
}
```

```bash
nginx -t && service nginx restart
```

### Firewall

```bash
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw enable
```

### HTTPS (optional but recommended)

```bash
apt install certbot python3-certbot-nginx
certbot --nginx -d yourdomain.com
```

### Deploying Updates

**From your local machine:**
```bash
git add .
git commit -m "Your update message"
git push origin master
```

**On the server:**
```bash
cd ~/k-t && git pull origin master && npm install && pm2 restart keydog
```

---

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/your-feature`
3. Commit your changes: `git commit -m "Add your feature"`
4. Push to the branch: `git push origin feature/your-feature`
5. Open a Pull Request

Please keep new features isolated to their own route and view files where possible to minimize conflicts.

---

## License

This project is proprietary and intended for internal campus use.
