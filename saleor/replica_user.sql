CREATE USER saleor_read WITH PASSWORD 'saleor';
GRANT CONNECT ON DATABASE saleor TO saleor_read;
