'use strict';

const path = require('path');
const express = require('express');

/**
 * Serves the single-page app, the sign-in page and the static assets.
 *
 * Two rules live here and nowhere else:
 *  - `/` renders the app for a signed-in visitor and the login page otherwise;
 *  - the app's own bundle and stylesheet are not downloadable without a
 *    session, so an anonymous visitor cannot read the UI code.
 *
 * @param {{ config: object, attachUserIfPresent: import('express').RequestHandler }} deps
 */
function createStaticSite({ config, attachUserIfPresent }) {
  const router = express.Router();
  const { staticDir, protectedAssetPrefixes } = config.http;

  const sendAppOrLogin = (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.sendFile(path.join(staticDir, req.user ? 'index.html' : 'login.html'));
  };

  router.get('/', attachUserIfPresent, sendAppOrLogin);
  router.get('/index.html', attachUserIfPresent, sendAppOrLogin);

  const isProtected = (requestPath) => protectedAssetPrefixes.some((prefix) => requestPath.startsWith(prefix));
  router.use((req, res, next) => {
    if (!isProtected(req.path)) return next();
    attachUserIfPresent(req, res, () => {
      if (!req.user) return res.status(401).type('text/plain').send('Sign-in required');
      next();
    });
  });

  router.use(
    express.static(staticDir, {
      index: false,
      etag: false,
      lastModified: false,
      setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache, must-revalidate')
    })
  );

  return router;
}

module.exports = { createStaticSite };
