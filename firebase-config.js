/* Firebase config for the shared MusiAsistente project. */
(function () {
  'use strict';

  window.MUSICALA_FIREBASE_CONFIG = {
    apiKey: 'AIzaSyCidm2EexcQ2t5ntsQ36wslc68PMIpOh6o',
    authDomain: 'musiasistente.firebaseapp.com',
    projectId: 'musiasistente',
    storageBucket: 'musiasistente.firebasestorage.app',
    messagingSenderId: '544443456620',
    appId: '1:544443456620:web:37fb8b9d5e7f167dee0c49'
  };

  window.MUSICALA_MESSAGES_FIREBASE = {
    enabled: true,
    collection: 'respuestasPredeterminadas',
    audioStoragePath: 'respuestas-predeterminadas-audios', imageStoragePath: 'respuestas-predeterminadas-imagenes'
  };
})();
