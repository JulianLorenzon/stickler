# Build environment for the APK: JDK 21, Node 20 and the Android SDK (see docs/BUILDING.md).
# Build-Tools 35 is what AGP 8.9 uses by default; without it Gradle downloads it again in every container.
# Used by tools/android-build/run.sh, which mounts the repo and a cache volume for Gradle and npm.
FROM node:20-bookworm-slim AS node

FROM eclipse-temurin:21-jdk-noble

COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
 && ln -s ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx

ARG CMDLINE_TOOLS=13114758
ENV ANDROID_HOME=/opt/android-sdk
RUN apt-get update && apt-get install -y --no-install-recommends unzip && rm -rf /var/lib/apt/lists/* \
 && mkdir -p $ANDROID_HOME/cmdline-tools \
 && curl -fsSL -o /tmp/tools.zip https://dl.google.com/android/repository/commandlinetools-linux-${CMDLINE_TOOLS}_latest.zip \
 && unzip -q /tmp/tools.zip -d $ANDROID_HOME/cmdline-tools && mv $ANDROID_HOME/cmdline-tools/cmdline-tools $ANDROID_HOME/cmdline-tools/latest \
 && rm /tmp/tools.zip \
 && yes | $ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager --licenses >/dev/null \
 && $ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager "platforms;android-36" "build-tools;35.0.0" "platform-tools" >/dev/null \
 && chmod -R a+rwX $ANDROID_HOME

# The container runs as the calling user, so the caches live in a world-writable volume
ENV PATH=$ANDROID_HOME/platform-tools:$PATH \
    HOME=/cache/home GRADLE_USER_HOME=/cache/gradle npm_config_cache=/cache/npm
RUN mkdir -p /cache/home /cache/gradle /cache/npm && chmod -R 1777 /cache
