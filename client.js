const axios = require('axios');
const fs = require('fs');
const path = require('path');

// Configuration
const CONFIG_PATH = path.join(__dirname, 'config.json');
const CONFIG = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));

// Allow command line arguments to override config
const args = process.argv.slice(2);
const SERVER_URL = getArgValue('--server-url') || CONFIG.client.serverUrl || 'http://localhost:3000';
const DEVICE_TYPE = 'vpn'; // This client is for the VPN device
const CHECK_INTERVAL = parseInt(getArgValue('--interval')) || CONFIG.client.checkInterval || 10 * 60 * 1000;
const RUN_CONTINUOUSLY = getArgValue('--continuous') !== null ? true : CONFIG.client.runContinuously || false;

// Helper function to get command line argument values
function getArgValue(name) {
  const index = args.indexOf(name);
  if (index !== -1 && index < args.length - 1) {
    return args[index + 1];
  }
  if (args.includes(name)) {
    return true; // Flag is present without value
  }
  return null;
}

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
