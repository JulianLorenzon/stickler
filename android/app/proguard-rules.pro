# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# If your project uses WebView with JS, uncomment the following
# and specify the fully qualified class name to the JavaScript interface
# class:
#-keepclassmembers class fqcn.of.javascript.interface.for.webview {
#   public *;
#}

# Uncomment this to preserve the line number information for
# debugging stack traces.
#-keepattributes SourceFile,LineNumberTable

# If you keep the line number information, uncomment this to
# hide the original source file name.
#-renamesourcefileattribute SourceFile

# Capacitor reads its annotations (@CapacitorPlugin with its permissions, @PluginMethod, ...) by reflection only, so
# R8's full optimisation concluded no instance of them could exist and dropped PluginHandle's
# `this.pluginAnnotation = pluginAnnotation`: getPluginAnnotation() returned null and the Bluetooth plugin crashed the
# app at start in requestPermissionForAliases (1.2.1, the first optimised release). Test builds didn't show it because
# being debuggable they skip those optimisations
-keep @interface com.getcapacitor.annotation.** { *; }
-keep @interface com.getcapacitor.NativePlugin { *; }
-keep @interface com.getcapacitor.PluginMethod { *; }
