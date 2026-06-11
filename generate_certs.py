import os
import datetime
import socket
from pathlib import Path
from cryptography import x509
from cryptography.x509.oid import NameOID
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa

def get_local_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"

def generate_self_signed_certs():
    ssl_dir = Path("config/ssl")
    ssl_dir.mkdir(parents=True, exist_ok=True)
    
    ca_key_path = ssl_dir / "rootCA.key"
    ca_cert_path = ssl_dir / "rootCA.crt"
    server_key_path = ssl_dir / "server.key"
    server_cert_path = ssl_dir / "server.crt"

    if ca_cert_path.exists() and server_cert_path.exists():
        print("Certs already exist. Skipping generation.")
        return

    print("Generating Local Root CA...")
    # 1. Generate Root CA Key
    ca_key = rsa.generate_private_key(public_exponent=65537, key_size=4096)
    
    # 2. Generate Root CA Certificate
    subject = issuer = x509.Name([
        x509.NameAttribute(NameOID.COUNTRY_NAME, "US"),
        x509.NameAttribute(NameOID.STATE_OR_PROVINCE_NAME, "California"),
        x509.NameAttribute(NameOID.LOCALITY_NAME, "San Francisco"),
        x509.NameAttribute(NameOID.ORGANIZATION_NAME, "Defect Tagger Local Hub"),
        x509.NameAttribute(NameOID.COMMON_NAME, "Defect Tagger Root CA"),
    ])
    
    ca_cert = x509.CertificateBuilder().subject_name(
        subject
    ).issuer_name(
        issuer
    ).public_key(
        ca_key.public_key()
    ).serial_number(
        x509.random_serial_number()
    ).not_valid_before(
        datetime.datetime.utcnow()
    ).not_valid_after(
        datetime.datetime.utcnow() + datetime.timedelta(days=3650)
    ).add_extension(
        x509.BasicConstraints(ca=True, path_length=None), critical=True,
    ).sign(ca_key, hashes.SHA256())

    # 3. Generate Server Key
    print("Generating Server Certificate...")
    server_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    
    local_ip = get_local_ip()
    server_subject = x509.Name([
        x509.NameAttribute(NameOID.COMMON_NAME, local_ip),
    ])
    
    import ipaddress
    
    # 4. Generate Server Certificate signed by Root CA
    server_cert = x509.CertificateBuilder().subject_name(
        server_subject
    ).issuer_name(
        ca_cert.subject
    ).public_key(
        server_key.public_key()
    ).serial_number(
        x509.random_serial_number()
    ).not_valid_before(
        datetime.datetime.utcnow()
    ).not_valid_after(
        datetime.datetime.utcnow() + datetime.timedelta(days=365)
    ).add_extension(
        x509.SubjectAlternativeName([
            x509.DNSName("localhost"),
            x509.IPAddress(ipaddress.IPv4Address("127.0.0.1")),
            x509.IPAddress(ipaddress.IPv4Address(local_ip)),
        ]),
        critical=False,
    ).sign(ca_key, hashes.SHA256())

    # Write files with restricted permissions
    def write_private_key(filepath, key):
        pem = key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.TraditionalOpenSSL,
            encryption_algorithm=serialization.NoEncryption(),
        )
        fd = os.open(str(filepath), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        try:
            os.write(fd, pem)
        finally:
            os.close(fd)
        try:
            filepath.chmod(0o600)
        except Exception:
            pass

    write_private_key(ca_key_path, ca_key)
    ca_cert_path.write_bytes(ca_cert.public_bytes(serialization.Encoding.PEM))
    
    write_private_key(server_key_path, server_key)
    server_cert_path.write_bytes(server_cert.public_bytes(serialization.Encoding.PEM))

    print(f"Certs generated for IP: {local_ip}")
    print(f"ROOT CA: {ca_cert_path}")
    print(f"SERVER CERT: {server_cert_path}")

if __name__ == "__main__":
    generate_self_signed_certs()
