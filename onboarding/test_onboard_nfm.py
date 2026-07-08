from onboard_nfm import monitors_env, desired_monitors

def test_monitors_env_format():
    assert monitors_env(["demo", "prod"]) == "nfm-eks-demo=demo,nfm-eks-prod=prod,nfm-vpc-all="

def test_desired_monitors_shapes():
    mons = desired_monitors(["demo"], ["vpc-1", "vpc-2"])
    eks = next(m for m in mons if m["monitorName"] == "nfm-eks-demo")
    assert eks["localResources"] == [{"type": "AWS::EKS::Cluster",
        "identifier": "arn:aws:eks:ap-northeast-2:<ACCOUNT_ID>:cluster/demo"}]
    vpc = next(m for m in mons if m["monitorName"] == "nfm-vpc-all")
    assert {"type": "AWS::EC2::VPC",
            "identifier": "arn:aws:ec2:ap-northeast-2:<ACCOUNT_ID>:vpc/vpc-1"} in vpc["localResources"]
