require('dotenv').config();
const axios = require('axios');
const fs = require('fs');

const CF_API = 'https://api.cloudflare.com/client/v4';
const TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
const IP_STORE = './last-ip.txt';
const CONFIG = JSON.parse(fs.readFileSync('./config.json', 'utf8'));
const TARGET_RECORDS = CONFIG.records || [];

async function getPublicIP() {
  const res = await axios.get('https://api.ipify.org?format=json');
  return res.data.ip;
}

function getLastKnownIP() {
  if (!fs.existsSync(IP_STORE)) return null;
  return fs.readFileSync(IP_STORE, 'utf8').trim();
}

function saveCurrentIP(ip) {
  fs.writeFileSync(IP_STORE, ip);
}

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

async function sendDiscordNotification(ip, updatedRecords) {
  if (!WEBHOOK_URL || updatedRecords.length === 0) return;

  const content = `🔧 IP updated to \`${ip}\`\n🎯 DNS Records:\n` +
    updatedRecords.map(r => `• \`${r.full}\``).join('\n');

  try {
    await axios.post(WEBHOOK_URL, { content });
    console.log('📢 Webhook sent to Discord.');
  } catch (err) {
    console.error('💥 Failed to send webhook:', err.message);
  }
}

(async () => {
  try {
    const currentIP = await getPublicIP();
    const lastIP = getLastKnownIP();

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
      await sendDiscordNotification(currentIP, updatedRecords);
    } else {
      console.log('⚠️ No records updated.');
    }

  } catch (err) {
    console.error('🔥 FATAL ERROR:', err.message);
  }
})();
