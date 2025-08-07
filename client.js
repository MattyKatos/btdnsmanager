require('dotenv').config();
const axios = require('axios');
const fs = require('fs');

// Configuration
const CONFIG = JSON.parse(fs.readFileSync('./config.json', 'utf8'));
const SERVER_URL = process.env.SERVER_URL || 'http://your-server-ip:3000';
const DEVICE_TYPE = 'vpn'; // This client is for the VPN device
const CHECK_INTERVAL = CONFIG.client.checkInterval || 10 * 60 * 1000; // Default from config
const RUN_CONTINUOUSLY = CONFIG.client.runContinuously || false; // Default from config

// Get public IP
async function getPublicIP() {
  try {
    const res = await axios.get('https://api.ipify.org?format=json');
    return res.data.ip;
  } catch (err) {
    console.error('❌ Failed to get public IP:', err.message);
    return null;
  }
}

// Report IP to server
async function reportIP(ip) {
  try {
    const response = await axios.post(`${SERVER_URL}/api/report-ip`, {
      deviceType: DEVICE_TYPE,
      ip
    });
    
    if (response.data.success) {
      console.log(`✅ Successfully reported IP ${ip} to server`);
      return true;
    } else {
      console.error('❌ Failed to report IP:', response.data.error || 'Unknown error');
      return false;
    }
  } catch (err) {
    console.error('❌ Failed to report IP to server:', err.message);
    return false;
  }
}

// Check server status
async function checkServerStatus() {
  try {
    const response = await axios.get(`${SERVER_URL}/api/status`);
    console.log('📊 Server status:', response.data);
    return response.data;
  } catch (err) {
    console.error('❌ Failed to check server status:', err.message);
    return null;
  }
}

// Main function
async function main() {
  console.log('🚀 Starting BT DNS Manager VPN Client...');
  
  // Check if server is reachable
  const status = await checkServerStatus();
  if (!status) {
    console.error('❌ Server is not reachable. Please check the SERVER_URL.');
    return;
  }
  
  // Get and report public IP
  const ip = await getPublicIP();
  if (ip) {
    await reportIP(ip);
    
    // Check if our IP matches the main device IP (which would be bad)
    if (status.devices && status.devices.main === ip) {
      console.warn(`⚠️ WARNING: VPN IP (${ip}) matches main IP (${status.devices.main})`);
      console.warn('This means your VPN might not be working correctly!');
    } else {
      console.log(`✅ VPN IP (${ip}) differs from main IP (${status.devices.main || 'unknown'})`);
    }
  }
}

// Run once immediately
main();

// If running in continuous mode, schedule periodic checks
if (RUN_CONTINUOUSLY) {
  console.log(`🔄 Will check IP every ${CHECK_INTERVAL / 60000} minutes`);
  setInterval(main, CHECK_INTERVAL);
} else {
  console.log('✅ One-time check complete. Exiting.');
}
