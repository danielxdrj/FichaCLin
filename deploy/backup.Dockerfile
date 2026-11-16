# Backup diário do Postgres, criptografado com age e (opcional) enviado para fora da VPS com rclone (REQ-29).
FROM postgres:16-alpine
RUN apk add --no-cache age rclone tzdata
COPY deploy/backup.sh deploy/restore.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/backup.sh /usr/local/bin/restore.sh
ENTRYPOINT ["/usr/local/bin/backup.sh"]
