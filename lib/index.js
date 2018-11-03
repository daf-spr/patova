'use strict';

const Boom = require('boom');
const Joi = require('joi');
const RateLimitHeaders = require('./rate_limit_headers');

const schema = Joi.object().keys({
  event: Joi.any().valid(['onRequest', 'onPreAuth', 'onPostAuth', 'onPreHandler']),
  type: [Joi.string(), Joi.func()],
  limitd: Joi.object(),
  onError: Joi.func(),
  extractKey: Joi.func(),
  onFinished: Joi.func(),
}).requiredKeys('type', 'event', 'limitd', 'extractKey');

function setResponseHeader(request, header, value) {
  if (!request.response) { return; }

  if (request.response.isBoom) {
    request.response.output.headers[header] = value;
  } else {
    request.response.header(header, value);
  }
}

function setupPreResponseExt(server, options) {
  server.ext('onPreResponse', (request, reply) => {
    const requestLimit = request.plugins.patova && request.plugins.patova.limit;

    if (requestLimit && requestLimit.conformant){
      const headers = new RateLimitHeaders(
          requestLimit.limit,
          requestLimit.remaining,
          requestLimit.reset);

      Object.keys(headers).forEach(
        key => setResponseHeader(request, key, headers[key]));
    }
    reply.continue();
  });
}

function getMinimumLimit(limit1, limit2) {
  if (!limit1) { return limit2; }
  if (!limit2) { return limit1; }

  if (limit1 && limit2.remaining > limit1.remaining) {
    return limit1;
  }

  return limit2;
}

function setupRateLimitEventExt(server, options) {
  const event = options.event;
  const extractKey = options.extractKey;
  const onError = options.onError;
  const onFinished = options.onFinished || (() => {});

  const extractKeyAndTakeToken = function(limitd, request, reply, type) {
    extractKey(request, reply, (err, key) =>{
      request.plugins.patova = request.plugins.patova || { start: Date.now() };

      if (err) {
        onFinished(err, request, Date.now() - request.plugins.patova.start, { rate_limited: false, error: true });
        return reply(err);
      }

      if (!limitd) {
        onFinished(new Error('Limitd is not provided'), request, Date.now() - request.plugins.patova.start, { rate_limited: false, error: true });
        // limitd is not connected, do not fail!
        return reply.continue();
      }

      limitd.take(type, key, (err, currentLimitResponse) => {
        if (err){
          onFinished(err, request, Date.now() - request.plugins.patova.start, { rate_limited: false, error: true });

          if (onError) {
            return onError(err, reply);
          }

          // by default we don't fail if limitd is unavailable
          return reply.continue();
        }

        const oldMinimumLimitResponse = request.plugins.patova && request.plugins.patova.limit
        const newMinimumLimitResponse = getMinimumLimit(currentLimitResponse, oldMinimumLimitResponse)

        request.plugins.patova = request.plugins.patova || {};
        request.plugins.patova.limit = newMinimumLimitResponse;

        if (newMinimumLimitResponse.conformant) {
          onFinished(null, request, Date.now() - request.plugins.patova.start, { rate_limited: false });
          // We continue only if the request is conformat so far
          return reply.continue();
        }

        const error = Boom.tooManyRequests();
        error.output.headers = new RateLimitHeaders(
          newMinimumLimitResponse.limit,
          newMinimumLimitResponse.remaining,
          newMinimumLimitResponse.reset);

        onFinished(null, request, Date.now() - request.plugins.patova.start, { rate_limited: true });
        reply(error);
      });
    });
  };

  const getType = function(request, reply, callback) {
    const type = options.type;

    if (typeof type !== 'function') {
      return process.nextTick(() => callback(null, type));
    }

    try {
      return type(request, (err, type) => {
        if (err) {
          return reply(Boom.wrap(err, 500, 'cannot get bucket type'));
        }

        callback(null, type);
      });
    } catch (err) {
      return reply(Boom.wrap(err, 500, 'cannot get bucket type'));
    }
  };

  server.ext(event, (request, reply) => {
    // This handler is going to be called one time per registration of patova
    getType(request, reply, (err, type) => {
      extractKeyAndTakeToken(options.limitd, request, reply, type);
    });
  });
}

exports.register = function (server, options, next) {
  Joi.validate(options, schema, { abortEarly: false }, (err, processedOptions) => {
    if (err) { return next(err); }
    setupRateLimitEventExt(server, processedOptions);
    setupPreResponseExt(server, processedOptions);
    next();
  });
};

exports.register.attributes = {
  pkg: require('../package.json'),
  multiple: true
};
