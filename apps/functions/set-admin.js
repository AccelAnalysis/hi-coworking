const admin = require('firebase-admin');

// Initialize Firebase Admin — uses Application Default Credentials (ADC)
// Run `firebase login` and ensure the correct project is selected.
admin.initializeApp({
  projectId: 'hi-coworking-plat',
});

async function setAdminRole(identifier) {
  try {
    let user;
    // Check if identifier is email or UID
    if (identifier.includes('@')) {
      user = await admin.auth().getUserByEmail(identifier);
    } else {
      user = await admin.auth().getUser(identifier);
    }
    await admin.auth().setCustomUserClaims(user.uid, { role: 'master' });
    console.log(`User ${identifier} (UID: ${user.uid}) set as master successfully.`);
  } catch (error) {
    console.error('Error setting admin role:', error);
  }
}

// Replace with the actual email or UID
setAdminRole('jholman@accelanalysis.com');
