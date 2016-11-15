# neat-webserver

## Installation
```
npm install neat-webserver --save
```


## Configuration
```
{
    port: 13337,                    // port on which to run the app
    maxBodySize: '10mb',            // max body size the server will accept
    cookieParser: {         
        "domain": "",               // domain for the cookie parser
        "secret": "neat-secret"     // secret for the cookie CHANGE THIS!
    },
    session: {
        name: "neat",               // name of the cookie being set for the session
        secret: "neat-secret",      // should be the same as above    
        enabled: true,              // enable sessions duh!
        resave: true,               // resave the session
        saveUninitialized: true,    // do save the session even if nothing has been set        
        cookie: {
            domain: "",             // domain for the session cookie parser
            secure: false           // use secure (SSL) cookies
        },
        store: {
            host: "localhost",      // redis host
            port: 6379,             // redis port
            password: null,         // redis password
            db: 0                   // redis db
        }
    }
}
```

## Usage

###### In your main.js
```
Application.registerModule("webserver", require("neat-webserver"));
```

###### In any module
Add a route
```
Application.modules.webserver.addRoute("get" || "post", "/url/for/route/.*?-:id.html", (req, res) => {
    res.end("Hello World");
});
```
Add middleware
```
Application.modules.webserver.addMiddleware("/path" || null, (req, res, next) => {
    req.test = true;
    next();    
});
```