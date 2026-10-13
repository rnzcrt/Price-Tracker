FROM lscr.io/linuxserver/chromium:latest

# copy only the extension files
COPY manifest.json popup.html /opt/pricewatch-ph/
COPY config /opt/pricewatch-ph/config
COPY css /opt/pricewatch-ph/css
COPY js /opt/pricewatch-ph/js
COPY icons /opt/pricewatch-ph/icons

# load the extension when Chromium starts
ENV CHROME_CLI="--load-extension=/opt/pricewatch-ph"
