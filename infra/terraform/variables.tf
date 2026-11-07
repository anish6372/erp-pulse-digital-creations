variable "aws_region" {
  default = "ap-south-1" # Mumbai - closest to an India-based team
}

variable "instance_type" {
  default = "t3.micro"
}

variable "project_name" {
  default = "pdc-erp"
}

variable "ssh_public_key_path" {
  default = "~/.ssh/pdc_erp_ed25519.pub"
}

variable "allowed_ssh_cidr" {
  description = "Your own IP, as x.x.x.x/32 - never leave SSH open to 0.0.0.0/0"
}
