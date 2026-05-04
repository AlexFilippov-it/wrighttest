FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y \
    bash \
    curl \
    fluxbox \
    novnc \
    websockify \
    x11vnc \
    xvfb \
    && rm -rf /var/lib/apt/lists/*

COPY start.sh /start.sh
RUN chmod +x /start.sh

ENV DISPLAY=:99
ENV VNC_PORT=5900
ENV NOVNC_PORT=6080

EXPOSE 5900 6080

CMD ["/start.sh"]
