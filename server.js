require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');

// Import original DNS functionality
const CF_API = 'https://api.cloudflare.com/client/v4';
const TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
const IP_STORE = './last-ip.txt';
const VPN_IP_STORE = './vpn-ip.txt';
const CONFIG = JSON.parse(fs.readFileSync('./config.json', 'utf8'));
const TARGET_RECORDS = CONFIG.records || [];
const PORT = process.env.PORT || CONFIG.server.port || 3000;

// Create Express app
const app = express();
app.use(cors());
app.use(bodyParser.json());

// Store for device IPs
const deviceIPs = {
  main: null,
  vpn: null
};

// Get public IP (for main device)
async function getPublicIP() {
  const res = await axios.get('https://api.ipify.org?format=json');
  return res.data.ip;
}

// Get stored IPs
function getLastKnownIP() {
  if (!fs.existsSync(IP_STORE)) return null;
  return fs.readFileSync(IP_STORE, 'utf8').trim();
}

function getLastKnownVpnIP() {
  if (!fs.existsSync(VPN_IP_STORE)) return null;
  return fs.readFileSync(VPN_IP_STORE, 'utf8').trim();
}

// Save IPs
function saveCurrentIP(ip) {
  fs.writeFileSync(IP_STORE, ip);
}

function saveVpnIP(ip) {
  fs.writeFileSync(VPN_IP_STORE, ip);
}

// Cloudflare API functions
async function getAllZones() {
  const res = await axios.get(`${CF_API}/zones`, {
    headers: { Authorization: `Bearer ${TOKEN}` }
  });
  return res.data.result;
}

async function getDNSRecords(zoneId) {
  const res = await axios.get(`${CF_API}/zones/${zoneId}/dns_records`, {
    headers: { Authorization: `Bearer ${TOKEN}` }
  });
  return res.data.result;
}

async function updateDNSRecord(zoneId, recordId, updatePayload) {
  const res = await axios.put(`${CF_API}/zones/${zoneId}/dns_records/${recordId}`, updatePayload, {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json'
    }
  });
  return res.data.success;
}

// Discord notification
async function sendDiscordNotification(ip, updatedRecords, vpnIp) {
  if (!WEBHOOK_URL || updatedRecords.length === 0) return;

  let content = `🔧 IP updated to \`${ip}\`\n🎯 DNS Records:\n` +
    updatedRecords.map(r => `• \`${r.full}\``).join('\n');
  
  if (vpnIp) {
    content += `\n\n🔒 VPN IP: \`${vpnIp}\``;
    if (ip === vpnIp) {
      content += `\n⚠️ WARNING: VPN IP matches main IP!`;
    } else {
      content += `\n✅ VPN IP differs from main IP (good)`;
    }
  }

  try {
    await axios.post(WEBHOOK_URL, { content });
    console.log('📢 Webhook sent to Discord.');
  } catch (err) {
    console.error('💥 Failed to send webhook:', err.message);
  }
}

// Check and update DNS if needed
async function checkAndUpdateDNS() {
  try {
    // Get current main IP
    const currentIP = await getPublicIP();
    deviceIPs.main = currentIP;
    
    const lastIP = getLastKnownIP();
    const vpnIP = deviceIPs.vpn || getLastKnownVpnIP();
    
    console.log(`📡 Main IP: ${currentIP}`);
    console.log(`🔒 VPN IP: ${vpnIP || 'unknown'}`);
    
    // Check if VPN IP is different from main IP (if we have a VPN IP)
    if (vpnIP && vpnIP === currentIP) {
      console.warn(`⚠️ WARNING: VPN IP (${vpnIP}) matches main IP (${currentIP})`);
      await sendDiscordNotification(currentIP, [], vpnIP);
      return;
    }
    
    // If IP hasn't changed, no need to update DNS
    if (currentIP === lastIP) {
      console.log(`🧘 IP hasn't changed (${currentIP}) — chillin' out.`);
      return;
    }

    const zones = await getAllZones();
    const updatedRecords = [];

    for (const fullRecord of TARGET_RECORDS) {
      const parts = fullRecord.split('.');
      if (parts.length < 2) continue;

      const recordName = fullRecord;
      const zoneName = parts.slice(-2).join('.');

      const zone = zones.find(z => z.name === zoneName);
      if (!zone) {
        console.warn(`⚠️ Zone not found for ${fullRecord}`);
        continue;
      }

      const records = await getDNSRecords(zone.id);
      const record = records.find(r => r.type === 'A' && r.name === recordName);

      if (!record) {
        console.warn(`⚠️ A record not found: ${recordName}`);
        continue;
      }

      if (record.content === currentIP) {
        console.log(`⏭️ ${recordName} already set to ${currentIP}`);
        continue;
      }

      const payload = {
        type: 'A',
        name: record.name,
        content: currentIP,
        ttl: 1,
        proxied: record.proxied
      };

      const success = await updateDNSRecord(zone.id, record.id, payload);

      if (success) {
        console.log(`✅ Updated ${record.name} in ${zone.name} to ${currentIP}`);
        updatedRecords.push({ full: record.name });
      } else {
        console.error(`❌ Failed to update ${record.name}`);
      }
    }

    if (updatedRecords.length > 0) {
      saveCurrentIP(currentIP);
      await sendDiscordNotification(currentIP, updatedRecords, vpnIP);
    } else {
      console.log('⚠️ No records updated.');
    }

  } catch (err) {
    console.error('🔥 FATAL ERROR:', err.message);
  }
}

// API Endpoints
app.get('/api/status', (req, res) => {
  res.json({
    status: 'ok',
    devices: {
      main: deviceIPs.main || 'unknown',
      vpn: deviceIPs.vpn || 'unknown'
    }
  });
});

// Web interface
app.get('/', (req, res) => {
  const mainIP = deviceIPs.main || 'unknown';
  const vpnIP = deviceIPs.vpn || 'unknown';
  const ipMatch = mainIP === vpnIP && mainIP !== 'unknown';
  
  const html = `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>BT DNS Manager Status</title>
    <style>
      body {
        font-family: Arial, sans-serif;
        max-width: 800px;
        margin: 0 auto;
        padding: 20px;
        line-height: 1.6;
      }
      .container {
        background-color: #f5f5f5;
        border-radius: 8px;
        padding: 20px;
        box-shadow: 0 2px 4px rgba(0,0,0,0.1);
      }
      h1 {
        color: #333;
        border-bottom: 1px solid #ddd;
        padding-bottom: 10px;
      }
      .ip-display {
        margin: 20px 0;
        padding: 15px;
        border-radius: 4px;
      }
      .ip-label {
        font-weight: bold;
        display: inline-block;
        width: 120px;
      }
      .status {
        margin-top: 20px;
        padding: 10px;
        border-radius: 4px;
        font-weight: bold;
      }
      .good {
        background-color: #d4edda;
        color: #155724;
      }
      .warning {
        background-color: #fff3cd;
        color: #856404;
      }
      .error {
        background-color: #f8d7da;
        color: #721c24;
      }
      .refresh {
        margin-top: 20px;
        text-align: center;
        color: #666;
        font-size: 0.9em;
      }
    </style>
  </head>
  <body>
    <div class="container">
      <h1>BT DNS Manager Status</h1>
      
      <div class="ip-display">
        <div><span class="ip-label">Main Device IP:</span> ${mainIP}</div>
        <div><span class="ip-label">VPN Device IP:</span> ${vpnIP}</div>
      </div>
      
      <div class="status ${ipMatch ? 'error' : (vpnIP === 'unknown' ? 'warning' : 'good')}">
        ${ipMatch ? '⚠️ WARNING: VPN IP matches main IP!' : 
          (vpnIP === 'unknown' ? '⚠️ Waiting for VPN device to report its IP...' : 
          '✅ VPN IP differs from main IP (good)')}
      </div>
      
      <div class="refresh">
        Last updated: ${new Date().toLocaleString()}
        <br>
        <small>This page auto-refreshes every 60 seconds</small>
      </div>
    </div>
    
    <script>
      // Auto-refresh the page every 60 seconds
      setTimeout(() => {
        window.location.reload();
      }, 60000);
    </script>
  </body>
  </html>
  `;
  
  res.send(html);
});

app.post('/api/report-ip', (req, res) => {
  const { deviceType, ip } = req.body;
  
  if (!deviceType || !ip) {
    return res.status(400).json({ error: 'Missing deviceType or ip' });
  }
  
  if (deviceType === 'vpn') {
    deviceIPs.vpn = ip;
    saveVpnIP(ip);
    console.log(`🔒 VPN IP updated: ${ip}`);
    
    // Check if VPN IP matches main IP
    if (deviceIPs.main && deviceIPs.main === ip) {
      console.warn(`⚠️ WARNING: VPN IP (${ip}) matches main IP (${deviceIPs.main})`);
    }
  }
  
  res.json({ success: true });
});

// Run initial check on startup
(async () => {
  try {
    console.log('🚀 Starting BT DNS Manager with multi-device support...');
    
    // Get main device IP
    const mainIP = await getPublicIP();
    deviceIPs.main = mainIP;
    console.log(`📡 Main IP: ${mainIP}`);
    
    // Get last known VPN IP if available
    const vpnIP = getLastKnownVpnIP();
    if (vpnIP) {
      deviceIPs.vpn = vpnIP;
      console.log(`🔒 Last known VPN IP: ${vpnIP}`);
    }
    
    // Start server
    app.listen(PORT, () => {
      console.log(`🌐 Server running on port ${PORT}`);
    });
    
    // Run initial DNS check
    await checkAndUpdateDNS();
    
    // Schedule periodic checks based on config
    const checkInterval = CONFIG.server.checkInterval || 15 * 60 * 1000;
    console.log(`🔄 Will check DNS every ${checkInterval / 60000} minutes`);
    setInterval(checkAndUpdateDNS, checkInterval);
    
  } catch (err) {
    console.error('🔥 FATAL ERROR:', err.message);
  }
})();
