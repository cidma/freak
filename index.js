var config = require('plain-config')();
var express = require('express');
var http = require('http');
var winston = require('winston');
var bodyParser = require('body-parser');
var ejsmate = require('ejs-mate');
var logger = new(winston.Logger)(config.winston);
var fs = require('fs');
var marked = require('marked');

var sprintf = require("sprintf-js").sprintf;
var hipchat = require('node-hipchat');
var nodemailer = require('nodemailer');

var app = express();
var server = require('http').Server(app);

var transporter = nodemailer.createTransport(config.email.smtpconf);

// Itemps to be reported
var items = {}

app.set('trust proxy');
app.use(bodyParser.json()); // to support JSON-encoded bodies
app.use(bodyParser.urlencoded({ // to support URL-encoded bodies
	extended: true
}));
app.engine('ejs', ejsmate);

app.set('views', __dirname + '/views');
app.set('view engine', 'ejs'); // so you can render('index')

app.use(express.static(__dirname + '/web'));

app.post('/report/:item', function(req, res, next) {
	if (items[req.params.item]) {
		logger.info('Got a ping from: ' + req.params.item);
		if (req.body.frequency) {items[req.params.item].frequency = req.body.frequency;}
		if (req.body.threshold) {items[req.params.item].threshold = req.body.threshold;}
		if (req.body.alert) {items[req.params.item].alert = req.body.alert;}
		items[req.params.item].reported = true;
		items[req.params.item].previousFailCount = items[req.params.item].failCount;
		items[req.params.item].failCount = 0;
		items[req.params.item].stamp = new Date().getTime();
		res.sendStatus(200);
	} else {
		if(req.body.frequency && req.body.alert) {
			logger.info('Adding new item: ' + req.params.item);
			items[req.params.item] = {
				name: req.params.item,
				frequency: req.body.frequency,
				threshold: (req.body.threshold ? req.body.threshold : 0),
				alert: req.body.alert,
				previousFailCount: 0,
				failCount: 0,
				reported: true,
				interval: null,
				miliseconds: 0,
				silence: null,
				silenceStart: null,
				stamp: new Date().getTime()
			}

			for(var x in config.defaultAlert) {
				items[req.params.item].alert.push(config.defaultAlert[x]);
			}

			items[req.params.item].check = function() {
				if (!this.item.reported) {
					if (this.item.failCount != null) {
						logger.warn('Adding');
						this.item.failCount++;
					} else {
						logger.warn('Reseting');
						this.item.failCount = 0;
					}
					notify(this.item, 'Crontol-Freak [%(name)s] - Fail: %(failCount)s\n\nhttp://' + req.hostname + ':' + config.port + '/status/%(name)s', 'Item: %(name)s - Failed');
					logger.warn('Failed: ' + this.item.name + " - Count: " + this.item.failCount);
				} else {
					logger.info(this.item.name + " UP");
				}
				this.item.reported = false;
			}.bind({
				item: items[req.params.item]
			});
			items[req.params.item].interval = setInterval(items[req.params.item].check, items[req.params.item].frequency);
			res.sendStatus(200);
		} else {
			logger.warn('Bad request received');
			res.sendStatus(400);
		}
	}
});

app.get('/list', function(req, res, next) {
	res.render('list', {
		items: items
	})
});

app.get('/doc', function(req, res) {
	var path = __dirname + '/README.md';
	var file = fs.readFileSync(path, 'utf8');
	// res.send(marked(file));
	res.render('doc', {
		doc: marked(file)
	})
});

app.get('/remove/:item', function(req, res, next) {
	logger.log('Removing');
	if (items[req.params.item]) {
		logger.info('Removing item: ' + req.params.item);
		clearInterval(items[req.params.item].interval);
		if (items[req.params.item].silence) {
			clearTimeout(items[req.params.item].silence);
		}
		notify(items[req.params.item], 'Crontol-Freak [%(name)s] - Item Removed from Monitoring', 'Item: %(name)s - Item Removed from Monitoring');
		delete items[req.params.item];
		res.sendStatus(200);
	} else {
		logger.warn('Failed to removing item: ' + req.params.items);
		res.sendStatus(404);
	}
});

app.get('/silence/:item/:miliseconds', function(req, res, next) {
	if (items[req.params.item]) {
		logger.info('Silence of ' + req.params.miliseconds + ' was set on ' + req.params.item)
		items[req.params.item].silenceMiliseconds = req.params.miliseconds
		clearInterval(items[req.params.item].interval);
		items[req.params.item].silenceStart = new Date().getTime();
		if (items[req.params.item].silence) {
			clearTimeout(items[req.params.item].silence);
		}
		items[req.params.item].silence = setTimeout(function() {
			logger.info('Silence is over, reseting interval');
			this.item.interval = setInterval(this.item.check, this.item.frequency);
			this.item.silenceStart = null;
			this.item.silence = null;
			notify(this.item, 'Crontol-Freak [%(name)s] - Monitoring Reactivated', 'Item: %(name)s - Monitoring Reactivated');
		}.bind({
			item: items[req.params.item]
		}), items[req.params.item].silenceMiliseconds);
		notify(items[req.params.item], 'Crontol-Freak [%(name)s] - Silenced for %(silenceMiliseconds)s ms', 'Item: %(name)s - Silenced: %(silenceMiliseconds)s ms');
		res.sendStatus(200);
	} else {
		res.sendStatus(404);
	}
});


app.get('/status/:item', function(req, res, next) {
	if (items[req.params.item]) {
		res.render('status', {
			item: items[req.params.item],
			name: req.params.item
		})
	} else {
		res.sendStatus(404);
	}
});

server.listen(config.port, function() {
	var address = server.address();
	logger.log('Webserver is UP' + address.address + ":" + address.port);
	console.info('Listening at http://%s:%s', address.address, address.port);
});

function notify(item, msg, subject) {
	if (item.threshold < item.failCount) {
		for (var i in item.alert) {
			switch (item.alert[i].type) {
				case 'email':
				transporter.sendMail({
					from: config.email.from,
					to: item.alert[i].data.email,
					subject: sprintf(subject, item),
					text: sprintf(msg, item)
				}, function(error, info) {
					if (error) {
						if (error.response) {
							logger.error(error + ' - ' + error.response + '(' + config.email.from + ')');
						} else {
							logger.error(error);
						}
						return;
					}
					logger.info('Notifier Email - Sent to:' + info.accepted + ' for item:' + item.name);
				});
				break;

				case 'hipchat':
				var hc = new hipchat(item.alert[i].data.key);
				hc.postMessage({
					room: item.alert[i].data.room,
					from: item.alert[i].data.from,
					message: sprintf(msg, item),
					color: (item.alert[i].data.color ? item.alert[i].data.color : 'yellow')
				}, function(data) {
					if (data && data != null && data.status && data.status == 'sent') {
						logger.info('Hipchat alert sent to:' + this.alert.data.room + ' as ' + this.alert.data.from + ' for item:' + this.item.name);
					} else {
						logger.warn('Hipchat alert attempt failed');
						if(data != null) {
							logger.warn(data);
						}
					}
				}.bind({item: item, alert: item.alert[i]}));
				logger.info('Hipchat alert sent to:' + item.alert[i].data.room + ' as ' + item.alert[i].data.from + ' for item:' + item.name);
				break;

				case 'custom':
				item.alert[i].notify(sprintf(msg, item));
				break;

				default:
				logger.warn('Unsupported alert type' + (item.alert[i].type ? item.alert[i].type : ' Undefined-type'));
				break;
			}
		}
	} else {
		logger.info('Item ' + item.name +' raised alert but is below threshold of '  + item.threshold + '. Fail count: ' + item.failCount);
	}
}





var args = [];
var tmp = process.argv.slice(2);
for(var i = 0; i < tmp.length; i++) {
	args[tmp[i]] = true;
}

/////////// Dev mode, prefill some data
// node index.js --dev
if (args['--dev']) {
	setInterval(function() {
		var freq = (Math.floor((Math.random() * 10) + 1) * 1000000) + 10000000;
		var body = JSON.stringify({frequency: freq, threshold: Math.floor(Math.random() * 10), alert: []});
		// freq = 5000;
		// var body = JSON.stringify({frequency: freq, threshold: Math.floor(Math.random() * 10), alert: [{'type': 'email', 'data': {'email': 'patrick.salomon@jomediainc.com'}}]});
		// var body = JSON.stringify({frequency: freq, threshold: Math.floor(Math.random() * 10), alert: [{'type': 'email', 'data': {'email': 'patrick.salomon@jomediainc.com'}}, {'type': 'hipchat'}, {'type': 'toto'}]});
		http.request({
			host: 'localhost', port: config.port, method: 'POST',
			path: '/report/test-' + Math.floor(Math.random() * 10),
			headers: {"Content-Type": "application/json","Content-Length": Buffer.byteLength(body)}
		}).end(body);
	}, 2000);
}
