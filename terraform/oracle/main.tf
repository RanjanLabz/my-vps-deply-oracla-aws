terraform {
  required_providers {
    oci = {
      source  = "oracle/oci"
      version = ">= 5.0"
    }
  }
}

provider "oci" {
  tenancy_ocid     = var.tenancy_ocid
  user_ocid        = var.user_ocid
  fingerprint      = var.fingerprint
  private_key_path = var.private_key_path
  region           = var.region
}

data "oci_identity_availability_domains" "ads" {
  compartment_id = var.tenancy_ocid
}

data "oci_core_images" "ubuntu" {
  compartment_id   = var.tenancy_ocid
  operating_system = "Canonical Ubuntu"
  shape            = var.instance_shape
  sort_by          = "TIMECREATED"
  sort_order       = "DESC"
}

locals {
  ad_name   = data.oci_identity_availability_domains.ads.availability_domains[0].name
  image_id  = data.oci_core_images.ubuntu.images[0].id
}

# VCN
resource "oci_core_vcn" "flowkit" {
  compartment_id = var.tenancy_ocid
  display_name   = "flowkit-vcn"
  cidr_block     = "10.0.0.0/16"
}

# Internet Gateway
resource "oci_core_internet_gateway" "flowkit" {
  compartment_id = var.tenancy_ocid
  vcn_id         = oci_core_vcn.flowkit.id
  display_name   = "flowkit-igw"
  enabled        = true
}

# Route Table
resource "oci_core_route_table" "flowkit" {
  compartment_id = var.tenancy_ocid
  vcn_id         = oci_core_vcn.flowkit.id
  display_name   = "flowkit-rt"

  route_rules {
    destination       = "0.0.0.0/0"
    destination_type  = "CIDR_BLOCK"
    network_entity_id = oci_core_internet_gateway.flowkit.id
  }
}

# Security List
resource "oci_core_security_list" "flowkit" {
  compartment_id = var.tenancy_ocid
  vcn_id         = oci_core_vcn.flowkit.id
  display_name   = "flowkit-sl"

  ingress_security_rules {
    protocol = "6"
    source   = "0.0.0.0/0"
    tcp_options {
      min = 22
      max = 22
    }
  }

  ingress_security_rules {
    protocol = "6"
    source   = "0.0.0.0/0"
    tcp_options {
      min = 3000
      max = 3000
    }
  }

  ingress_security_rules {
    protocol = "6"
    source   = "0.0.0.0/0"
    tcp_options {
      min = 8100
      max = 8100
    }
  }

  ingress_security_rules {
    protocol = "6"
    source   = "0.0.0.0/0"
    tcp_options {
      min = 9222
      max = 9222
    }
  }

  ingress_security_rules {
    protocol = "1"
    source   = "0.0.0.0/0"
  }

  egress_security_rules {
    protocol    = "all"
    destination = "0.0.0.0/0"
  }
}

# Subnet
resource "oci_core_subnet" "flowkit" {
  compartment_id      = var.tenancy_ocid
  vcn_id              = oci_core_vcn.flowkit.id
  display_name        = "flowkit-subnet"
  cidr_block          = "10.0.0.0/24"
  route_table_id      = oci_core_route_table.flowkit.id
  security_list_ids   = [oci_core_security_list.flowkit.id]
}

# Compute Instance
resource "oci_core_instance" "flowkit" {
  compartment_id      = var.tenancy_ocid
  availability_domain = local.ad_name
  display_name        = var.instance_name
  shape               = var.instance_shape

  shape_config {
    ocpus         = var.ocpus
    memory_in_gbs = var.memory_gb
  }

  source_details {
    source_type = "image"
    source_id   = local.image_id
  }

  create_vnic_details {
    subnet_id        = oci_core_subnet.flowkit.id
    assign_public_ip = true
    display_name     = "flowkit-vnic"
  }

  metadata = {
    ssh_authorized_keys = var.ssh_public_key
    user_data           = base64encode(file("${path.module}/scripts/setup.sh"))
  }

  timeouts {
    create = "30m"
  }
}

# Outputs
output "instance_id" {
  value = oci_core_instance.flowkit.id
}

output "public_ip" {
  value = oci_core_instance.flowkit.public_ip
}

output "instance_state" {
  value = oci_core_instance.flowkit.state
}
