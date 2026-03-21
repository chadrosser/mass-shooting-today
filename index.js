require('dotenv').config();
const { getToday } = require('./api');

async function main() {
  const data = await getToday();
  
  if (!data) {
    console.log('Error fetching data');
    return;
  }

  console.log(`Date: ${data.date}`);
  console.log(`Had shooting: ${data.hadShooting}`);
  console.log(`Incidents: ${data.incidents.length}`);
  console.log(JSON.stringify(data, null, 2));
}

main();