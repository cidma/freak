crontol-freak
=============

A mini service to monitor crons. It requires no configuration to add new crons. Crons can confiure it themselves.

API
=============
POST

/report/:namespace

Pings specific namespace, and set-ups monitoring. 

```javascript
var http = require('http');

var body = JSON.stringify({
	frequency: 10000,
	alert: [{
		type: 'email',
		data: {
			email: 'address@domain.com'
		}
	}, {
		type: 'hipchat',
		data: {
			room: 'roomname',
			key: 'key',
			from: 'user',
			color: 'yellow'
		}
	}]
})


http.request({
	host: 'localhost',
	port: 8081,
	method: 'POST',
	path: '/report/test',
	headers: {
		"Content-Type": "application/json",
		"Content-Length": Buffer.byteLength(body)
	}
}).end(body);
```

GET

/remove/:namespace

Allows to remove monitoring of specific namespace

/silence/:item/:miliseconds

Allows to silence alerts for specific namespace for specific amount of time

UI
=============
/status/:item

A way to view the state of a specific namespace
