# call pack.sh in aide-rap
# transfer zip to server home (outside http root)
unzip -o *aide-rap*.zip
cd aide-rap
npm install better-sqlite3 --rebuild-from-source
npm install
pm2 delete (old instance)
pm2 start app/rap.js --name aide-rap-irma -- -s irma
pm2 save
