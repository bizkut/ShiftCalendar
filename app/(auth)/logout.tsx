import { Redirect } from 'expo-router';
import React from 'react';

export default function LogoutCallbackScreen() {
  return <Redirect href="/login" />;
}
