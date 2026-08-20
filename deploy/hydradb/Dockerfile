# HydraDB, packaged so a host that only offers environment variables can run it.
#
# The upstream image reads its bearer token from a *file* named by
# GRAPH_AUTH_TOKEN_FILE. That is fine locally, where `npm run hydra:setup`
# writes the file before the container boots, and impossible on a platform where
# the only thing you can inject is an environment variable. This wrapper writes
# the file at startup from GRAPH_AUTH_TOKEN and then hands over to the real
# binary unchanged.
#
# Nothing about HydraDB itself is modified or rebuilt — it is the published
# image with three lines of shell in front of it — so the AGPL obligations that
# come with modifying it do not arise.

FROM ghcr.io/hydra-db/hydradb:latest

COPY entrypoint.sh /render-entrypoint.sh

# Ownership and mode set explicitly: the base image may run as a non-root user,
# and an entrypoint nobody can execute fails with a message that says nothing
# useful about why.
USER root
RUN chmod 0755 /render-entrypoint.sh

EXPOSE 8443

ENTRYPOINT ["/render-entrypoint.sh"]
