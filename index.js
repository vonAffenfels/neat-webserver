"use strict";

var Module = require("neat-base").Module;
var express = require("express");
var compression = require("compression");
var responseTime = require('response-time');
var bodyParser = require('body-parser');
var methodOverride = require('method-override');
var cookieParser = require('cookie-parser');
var session = require('express-session');
var connectRedis = require('connect-redis');
var apeStatus = require('ape-status');
var cors = require('cors');
var fs = require('fs');
var ejs = require('ejs');
var Promise = require("bluebird");

module.exports = class Webserver extends Module {

    static defaultConfig() {
        return {
            port: 13337,
            maxBodySize: '10mb',
            cookieParser: {
                "domain": "",
                "secret": "neat-secret"
            },
            session: {
                name: "neat",
                secret: "neat-secret",
                enabled: true,
                resave: true,
                saveUninitialized: true,
                cookie: {
                    domain: "",
                    secure: false
                },
                store: {
                    connect_timeout: 1000,
                    retry_max_delay: 1000,
                    prefix: "neat-session_",
                    retry_unfulfilled_commands: true,
                    host: "localhost",
                    port: 6379,
                    password: null,
                    db: 0
                }
            }
        }
    }

    init() {
        this.routes = [];
        this.middlewares = [];
        this.listening = false;

        return new Promise((resolve, reject) => {
            this.log.debug("Initializing...");

            var storeConfig = this.config.session.store;
            var redisStore = connectRedis(session);
            var self = this;

            if (!storeConfig.password) {
                delete storeConfig.password;
            }

            storeConfig.retry_strategy = function (options) {
                self.log.debug("Reconnecting to session redis in 1 second");
                return 1000;
            };
            this.config.session.store = new redisStore(storeConfig);

            this.webserver = express();
            this.webserver.set('trust proxy', 1);
            this.webserver.engine('html', ejs.renderFile);

            this.webserver.use(compression());
            this.webserver.use(responseTime());
            this.webserver.use(bodyParser.urlencoded({
                extended: false,
                limit: this.config.maxBodySize
            }));
            this.webserver.use(bodyParser.json({
                limit: this.config.maxBodySize
            }));
            this.webserver.use(methodOverride());
            this.webserver.use(cookieParser(this.config.cookieParser.secret));
            if (this.config.session.enabled) {
                this.sessionMiddleware = session(this.config.session);
                this.webserver.use(this.sessionMiddleware);
                this.webserver.use(function (req, res, next) {
                    if (!req.session) {
                        return next(new Error('Session is required but not available!'));
                    }
                    next();
                });
            }

            if (this.config.cors) {
                var corsOptions = {
                    credentials: true,
                    methods: [
                        'GET',
                        'POST',
                        'OPTIONS'
                    ],
                    allowedHeaders: [
                        'Cookie',
                        'Language',
                        'Filter',
                        'Accept',
                        'Content-Type',
                        'Authorization',
                        'Content-Length'
                    ],
                    exposedHeaders: [
                        'Set-Cookie',
                        'X-Response-Time'
                    ],
                    origin: (origin, callback) => {
                        return callback(null, this.config.cors.indexOf(origin) !== -1);
                    }
                };
            }

            this.webserver.use(cors(corsOptions));
            this.webserver.use(apeStatus.express);

            this.webserver.use((req, res, next) => {
                res.err = (err, status) => {
                    status = status || 500;

                    var result = {};

                    switch (typeof err) {
                        case "object":

                            // mongoose style error
                            if (err.name) {
                                if (err.name === "ValidationError") {
                                    var formattedError = {};
                                    for (var field in err.errors) {
                                        formattedError[field] = err.errors[field].message;
                                    }

                                    result = formattedError;
                                } else {
                                    result = err;
                                }
                                status = 400;
                            } else if (err instanceof Error) {
                                res.status(500);
                                return res.end("<pre>" + err.toString() + ": <br> " + err.stack);
                            } else {
                                if (err.status) {
                                    res.status(err.status);
                                }

                                return res.json(err);
                            }

                            break;

                        case "string":
                        case "number":
                            switch (err) {
                                case 404:
                                    res.status(404);
                                    return res.end();
                                default:
                                    result = err;
                                    break;
                            }
                        default:
                            result = err;
                            break;
                    }

                    this.log.debug(result);
                    res.status(status);
                    return res.json(result);
                }

                return next();
            });

            resolve(this);
        });
    }

    addMiddleware(path, func, sort) {
        if (arguments.length < 2) {
            sort = func;
            func = path;
            path = null;
        }

        this.middlewares.push({
            func: func,
            path: path,
            sort: sort !== undefined ? sort : this.middlewares.length
        });
    }

    initMiddlewares() {
        this.middlewares.sort(function (a, b) {
            a = a.sort;
            b = b.sort;

            if (a > b) {
                return 1;
            } else if (a < b) {
                return -1;
            } else {
                return 0;
            }
        });

        for (var i = 0; i < this.middlewares.length; i++) {
            var obj = this.middlewares[i];
            if (obj.path) {
                this.webserver.use(obj.path, obj.func);
            } else {
                this.webserver.use(obj.func);
            }
        }
    }

    /*
     method, path, ...func, sort
     */
    addRoute() {
        var argsArray = ((args) => {
            var result = [];
            for (var key in args) {
                result.push(args[key]);
            }
            return result;
        })(arguments);

        var method = argsArray.shift();
        var path = argsArray.shift();
        var sort = undefined;
        var funcs = [];

        if (typeof method !== "string") {
            throw new Error("invalid method for addRoute!");
        }

        if (typeof path !== "string" && !path instanceof RegExp) {
            throw new Error("invalid path for addRoute!");
        }

        for (var i = 0; i < argsArray.length; i++) {
            var func = argsArray[i];

            if (typeof func === "function") {
                funcs.push(func);
            } else {
                sort = func;
            }
        }

        this.routes.push({
            method: method,
            path: path,
            funcs: funcs,
            sort: sort !== undefined ? sort : this.routes.length
        });
    }

    initRoutes() {
        this.routes.sort(function (a, b) {
            a = a.sort;
            b = b.sort;

            if (a > b) {
                return 1;
            } else if (a < b) {
                return -1;
            } else {
                return 0;
            }
        });

        for (var i = 0; i < this.routes.length; i++) {
            var obj = this.routes[i];
            var params = [];

            params.push(obj.path);
            params = params.concat(obj.funcs);

            this.log.debug("Adding route " + obj.path + " (" + obj.method + ")");

            this.webserver[obj.method].apply(this.webserver, params);
        }

        // reset routes, maybe some modules want to add more dynamically?
        this.routes = [];
    }

    start() {
        return new Promise((resolve, reject) => {
            this.log.debug("Starting...");

            this.initMiddlewares();
            this.initRoutes();

            apeStatus.info("port", this.config.port);
            this.httpServer = this.webserver.listen(this.config.port, () => {
                this.log.info("Webserver listening on " + this.config.port);
                this.listening = true;
                resolve(this);
            });
        });
    }

    stop() {
        return new Promise((resolve, reject) => {
            this.log.debug("Stopping...");
            this.httpServer.close();
            resolve(this);
        });
    }

}