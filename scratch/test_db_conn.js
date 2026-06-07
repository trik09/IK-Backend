import mongoose from 'mongoose';

const uris = {
  local: 'mongodb://127.0.0.1:27017/quickchess',
  standard_direct: 'mongodb://quickchess4kids_db_user:u8TWmVZIEkj9ZY17@ac-9cxm70m-shard-00-00.egwucqz.mongodb.net:27017,ac-9cxm70m-shard-00-01.egwucqz.mongodb.net:27017,ac-9cxm70m-shard-00-02.egwucqz.mongodb.net:27017/quickchess?ssl=true&replicaSet=atlas-9cxm70m-shard-0&authSource=admin&retryWrites=true&w=majority'
};

async function testConnection(name, uri) {
  console.log(`Testing connection to ${name}...`);
  try {
    const conn = await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
    console.log(`✅ Success connecting to ${name}!`);
    await mongoose.disconnect();
    return true;
  } catch (err) {
    console.log(`❌ Failed connecting to ${name}: ${err.message}`);
    return false;
  }
}

async function run() {
  await testConnection('Local MongoDB', uris.local);
  await testConnection('Standard Direct Shard', uris.standard_direct);
  process.exit(0);
}

run();
