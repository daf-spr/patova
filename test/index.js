'use strict';
const expect  = require('chai').expect;
const plugin  = require('../');
const server  = require('./server');
const limitServer  = require('./limitdServer');
const Boom    = require('boom');

const EXTRACT_KEY_NOOP = () => {};

describe('options validation', () => {
  it ('should fail if event is not specified', () => {
    plugin.register(null, {
      type: 'user',
      address: 'limitd://10.0.0.1:8090',
      extractKey: EXTRACT_KEY_NOOP
    }, err => {
      expect(err.details).to.have.length(1);

      var firstError = err.details[0];
      expect(firstError.message).to.equal('"event" is required');
    });
  });

  it ('should fail if event is not valid', () => {
    plugin.register(null, {
      event: 'invalid',
      type: 'user',
      address: 'limitd://10.0.0.1:8090',
      extractKey: EXTRACT_KEY_NOOP
    }, err => {
      expect(err.details).to.have.length(1);

      const firstError = err.details[0];
      expect(firstError.message).to.equal('"event" must be one of [onRequest, onPreAuth, onPostAuth, onPreHandler]');
    });
  });

  it ('should fail if type is not specified', () => {
    plugin.register(null, {
      event: 'onRequest',
      address: 'limitd://10.0.0.1:8090',
      extractKey: EXTRACT_KEY_NOOP
    }, err => {
      expect(err.details).to.have.length(1);

      const firstError = err.details[0];
      expect(firstError.message).to.equal('"type" is required');
    });
  });

  it ('should fail if type is of wrong type', () => {
    plugin.register(null, {
      type: 2,
      event: 'onRequest',
      address: 'limitd://10.0.0.1:8090',
      extractKey: EXTRACT_KEY_NOOP
    }, err => {
      expect(err.details).to.have.length(1);

      const firstError = err.details[0];
      expect(firstError.message).to.equal('"type" must be a string');
    });
  });

  it ('should fail if type is empty string', () => {
    plugin.register(null, {
      type: '',
      event: 'onRequest',
      address: 'limitd://10.0.0.1:8090',
      extractKey: EXTRACT_KEY_NOOP
    }, err => {
      expect(err.details).to.have.length(1);

      const firstError = err.details[0];
      expect(firstError.message).to.equal('"type" is not allowed to be empty');
    });
  });

  it ('should fail if onError is not a function', () => {
    plugin.register(null, {
      type: 'user',
      event: 'onRequest',
      address: 'limitd://10.0.0.1:8090',
      onError: 'string',
      extractKey: EXTRACT_KEY_NOOP
    }, err => {
      expect(err.details).to.have.length(1);

      const firstError = err.details[0];
      expect(firstError.message).to.equal('"onError" must be a Function');
    });
  });

  it ('should fail if extractKey is not a function', () => {
    plugin.register(null, {
      type: 'user',
      event: 'onRequest',
      address: 'limitd://10.0.0.1:8090',
      extractKey: 'string'
    }, err => {
      expect(err.details).to.have.length(1);

      var firstError = err.details[0];
      expect(firstError.message).to.equal('"extractKey" must be a Function');
    });
  });

  it ('should fail if extractKey is not provided', () => {
    plugin.register(null, {
      type: 'user',
      event: 'onRequest',
      address: 'limitd://10.0.0.1:8090',
    }, err => {
      expect(err.details).to.have.length(1);

      const firstError = err.details[0];
      expect(firstError.message).to.equal('"extractKey" is required');
    });
  });

  it ('should fail if address is not provided', () => {
    plugin.register(null, {
      type: 'user',
      event: 'onRequest',
      extractKey: EXTRACT_KEY_NOOP
    }, err => {
      expect(err.details).to.have.length(1);
      const firstError = err.details[0];
      expect(firstError.message).to.equal('"address" is required');
    });
  });

  it ('should fail if address is not string', () => {
    plugin.register(null, {
      type: 'user',
      event: 'onRequest',
      extractKey: EXTRACT_KEY_NOOP,
      address: 1
    }, err => {
      expect(err.details).to.have.length(2);

      const firstError = err.details[0];
      expect(firstError.message).to.equal('"address" must be a string');

      const secondError = err.details[1];
      expect(secondError.message).to.equal('"address" must be an object');
    });
  });

  it ('should fail address is not uri with limitd schema', () => {
    plugin.register(null, {
      type: 'user',
      event: 'onRequest',
      extractKey: EXTRACT_KEY_NOOP,
      address: 'https://auth0.com'
    }, err => {
      expect(err.details).to.have.length(2);

      const firstError = err.details[0];
      expect(firstError.message).to.equal('"address" must be a valid uri with a scheme matching the limitd pattern');

      const secondError = err.details[1];
      expect(secondError.message).to.equal('"address" must be an object');
    });
  });
});

describe('with server', () => {
  describe ('when extractKey fails', () => {
    before(done => {
      server.start({
        type: 'user',
        address: 'limitd://10.0.0.1:8090',
        extractKey: (request, reply, done) => {
          done(Boom.internal('Failed to retrieve key'));
        },
        event: 'onPostAuth'
      }, done);
    });
    after(server.stop);

    it ('should send response with error', done => {
      const request = { method: 'POST', url: '/users', payload: { } };

      server.inject(request, res => {
        const body = JSON.parse(res.payload);

        expect(res.statusCode).to.equal(500);
        expect(body.statusCode).to.equal(500);
        expect(body.error).to.equal('Internal Server Error');
        expect(body.message).to.equal('An internal server error occurred');

        done();
      });
    });
  });

  describe ('when limitd does not provide a response and there is no onError',function(){
    before(done => {
      server.start({
        type: 'user',
        address: 'limitd://10.0.0.1:8090',
        extractKey: (request, reply, done) => {
          done(null, 'notImportant');
        },
        event: 'onPostAuth'
      }, done);
    });

    after(server.stop);
    it('should return 200', done => {
      const request = { method: 'POST', url: '/users', payload: { } };
      server.inject(request, res => {
        expect(res.statusCode).to.equal(200);
        expect(res.payload).to.equal('created');

        done();
      });
    });
  });

  describe ('when limitd does not responsd and there is onError', () => {
    before(done => {
      server.start({
        type: 'user',
        address: 'limitd://10.0.0.1:8090',
        extractKey: (request, reply, done) => {
          done(null, 'notImportant');
        },
        event: 'onPostAuth',
        onError: (err, reply) => { reply(Boom.wrap(err, 500)); }
      }, done);
    });

    after(server.stop);
    it('should return what onError returns', done => {
      const request = { method: 'POST', url: '/users', payload: { } };
      server.inject(request, res => {
        const body = JSON.parse(res.payload);

        expect(res.statusCode).to.equal(500);
        expect(body.statusCode).to.equal(500);
        expect(body.error).to.equal('Internal Server Error');
        expect(body.message).to.equal('An internal server error occurred');

        done();
      });
    });
  });


  describe('with limitd running', () => {
    let address;
    before(done => {
      limitServer.start(r => {
        address = r;
        done();
      });
    });

    after(limitServer.stop);

    describe('when limitd responds non conformant', () => {
      before(done => {
        server.start({
          type: 'empty',
          address: { host: address.address, port: address.port },
          extractKey: (request, reply, done) => { done(null, 'notImportant'); },
          event: 'onPostAuth',
          onError: (err, reply) => { reply(Boom.wrap(err, 500)); }
        }, done);
      });

      after(server.stop);

      it('should send response with 429 and headers', done => {
        const request = { method: 'POST', url: '/users', payload: { } };
        server.inject(request, res => {
          const body = JSON.parse(res.payload);
          const headers = res.headers;

          expect(body.statusCode).to.equal(429);
          expect(body.error).to.equal('Too Many Requests');

          expect(headers['x-ratelimit-limit']).to.equal(0);
          expect(headers['x-ratelimit-remaining']).to.equal(0);
          expect(headers['x-ratelimit-reset']).to.equal(0);

          done();
        });
      });
    });

    describe('when check is skipped', () => {
      before(done => {
        server.start({
          type: 'empty',
          address: { host: address.address, port: address.port },
          extractKey: (request, reply) => { reply.continue(); },
          event: 'onPostAuth',
          onError: (err, reply) => { reply(Boom.wrap(err, 500)); }
        }, done);
      });

      after(server.stop);

      it('should send response with 200', done => {
        const request = { method: 'POST', url: '/users', payload: { } };
        server.inject(request, res => {
          expect(res.statusCode).to.equal(200);
          expect(res.payload).to.equal('created');

          done();
        });
      });
    });

    describe('when limitd responds conformant', () => {
      before((done) => {
        server.start({
          type: 'users',
          address: { host: address.address, port: address.port },
          extractKey: (request, reply, done) => { done(null, 'key'); },
          event: 'onPostAuth',
          onError: (err, reply) => { reply(Boom.wrap(err, 500)); }
        }, done);
      });

      after(server.stop);

      it('should send response with 200 if limit is not passed and set limit header', function(done){
        const request = { method: 'POST', url: '/users', payload: { } };
        const startDate = Math.floor((new Date()).getTime() / 1000);
        server.inject(request, res => {
          expect(res.statusCode).to.equal(200);
          expect(res.payload).to.equal('created');

          const headers = res.headers;
          expect(headers['x-ratelimit-limit']).to.equal(1000000);
          expect(headers['x-ratelimit-remaining']).to.equal(999999);
          expect(headers['x-ratelimit-reset']).to.be.greaterThan(startDate);

          done();
        });
      });
    });
  });
});